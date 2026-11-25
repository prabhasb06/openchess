"""Package and sign the OpenChess Android app with a local Android SDK and Stockfish."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
ANDROID = "http://schemas.android.com/apk/res/android"
EXE = ".exe" if os.name == "nt" else ""
CHESS_LOCAL_ID = "local.chess.app"
CHESS_LOCAL_CERTIFICATE = "e17f8270c7a1b2b63ab2efc8365476df63ede994a63a37bcf16d77e699519cdc"

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)

def newest(candidates):
    return max(candidates, key=lambda path: tuple(int(part) for part in re.findall(r"[0-9]+", path.name)))

def build(args):
    sdk = args.sdk or Path(os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME")
                           or Path.home() / "AppData/Local/Android/Sdk")
    platforms = [path for path in (sdk / "platforms").glob("android-*") if (path / "android.jar").is_file()]
    tools = [path for path in (sdk / "build-tools").glob("*") if (path / ("aapt2" + EXE)).is_file()]
    if not platforms or not tools:
        raise SystemExit("Install an Android SDK platform and build-tools, or pass --sdk.")
    platform = newest(platforms) / "android.jar"
    tools = newest(tools)
    java = shutil.which("java")
    javac = shutil.which("javac")
    if not java or not javac:
        raise SystemExit("Put a JDK with java and javac on PATH.")
    engine = ROOT / ("build/emulator-engine/libstockfish.so" if args.emulator else "engine/libstockfish.so")
    if not engine.is_file():
        raise SystemExit("Prepare the local Stockfish binary as described in README.md.")
    engine_record = json.loads((ROOT / "engine/stockfish.json").read_text())
    digest = hashlib.sha256(engine.read_bytes()).hexdigest()
    if not args.emulator and digest != engine_record["binarySha256"]:
        raise SystemExit("The Android Stockfish signature does not match stockfish.json.")
    abi = "x86_64" if args.emulator else "arm64-v8a"
    key = Path(os.environ.get("OPENCHESS_SIGNING_KEY", ROOT / "signing/openchess-debug.keystore"))
    custom_key = "OPENCHESS_SIGNING_KEY" in os.environ
    if args.release and (not custom_key or args.application_id):
        raise SystemExit("--release requires the original Chess Local signing key and package ID.")
    if not args.release and args.application_id == CHESS_LOCAL_ID:
        raise SystemExit("Use --release and the original signing key for local.chess.app.")
    app_id = CHESS_LOCAL_ID if args.release else args.application_id or "local.chess.openchess"
    alias = os.environ.get("OPENCHESS_SIGNING_ALIAS", "openchess")
    password = "env:OPENCHESS_SIGNING_PASSWORD" if custom_key else "pass:android"
    if custom_key and (not key.is_file() or not os.environ.get("OPENCHESS_SIGNING_PASSWORD")):
        raise SystemExit("Provide the existing key and OPENCHESS_SIGNING_PASSWORD.")
    if not key.is_file():
        keytool = shutil.which("keytool") or str(Path(javac).resolve().with_name("keytool" + EXE))
        key.parent.mkdir(parents=True, exist_ok=True)
        run(keytool, "-genkeypair", "-keystore", key, "-storepass", "android", "-keypass", "android",
            "-alias", alias, "-dname", "CN=OpenChess Development", "-keyalg", "RSA", "-validity", "10000")
    flavor = "chess-local" if args.release else "openchess"
    suffix = "-emulator" if args.emulator else ""
    output = args.output or PROJECT / "downloads" / f"{flavor}{suffix}.apk"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="openchess-apk-") as temporary:
        work = Path(temporary)
        web = work / "assets/www"
        shutil.copytree(PROJECT / "dist-apk", web)
        shutil.copytree(PROJECT / "public/chess-local", web / "chess-local")
        notice = web / "chess-local/stockfish"
        notice.mkdir()
        shutil.copy2(ROOT / "engine/COPYING.txt", notice / "COPYING.txt")
        engine_record.update(abi=abi, binarySha256=digest)
        (notice / "stockfish.json").write_text(json.dumps(engine_record, indent=2), encoding="utf8")
        ET.register_namespace("android", ANDROID)
        manifest = ET.parse(ROOT / "AndroidManifest.xml")
        manifest.getroot().set("package", app_id)
        if args.emulator:
            manifest.find("application").set(f"{{{ANDROID}}}debuggable", "true")
        manifest.write(work / "AndroidManifest.xml", encoding="utf-8", xml_declaration=True)
        compiled = work / "resources.zip"
        aapt = tools / ("aapt2" + EXE)
        run(aapt, "compile", "--dir", ROOT / "res", "-o", compiled)
        run(aapt, "link", "-I", platform, "--manifest", work / "AndroidManifest.xml",
            "-A", work / "assets", "-o", work / "unsigned.apk", compiled)
        classes, dex = work / "classes", work / "dex"
        classes.mkdir()
        dex.mkdir()
        run(javac, "-source", "17", "-target", "17", "-Xlint:all", "-Xlint:-options", "-Werror",
            "-encoding", "UTF-8", "-classpath", platform,
            "-d", classes, *sorted((ROOT / "src").rglob("*.java")))
        run(java, "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--min-api", "26",
            "--lib", platform, "--output", dex, *sorted(classes.rglob("*.class")))
        with zipfile.ZipFile(work / "unsigned.apk") as entries, zipfile.ZipFile(work / "packed.apk", "w") as apk:
            for member in sorted(entries.infolist(), key=lambda item: item.filename):
                apk.writestr(zipfile.ZipInfo(member.filename), entries.read(member), compress_type=member.compress_type)
            for item in sorted(dex.glob("*.dex")):
                apk.writestr(zipfile.ZipInfo(item.name), item.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
            engine_entry = zipfile.ZipInfo(f"lib/{abi}/libstockfish.so")
            engine_entry.file_size = engine.stat().st_size
            with engine.open("rb") as source, apk.open(engine_entry, "w") as destination:
                shutil.copyfileobj(source, destination)
        zipalign = tools / ("zipalign" + EXE)
        run(zipalign, "-f", "-P", "16", "4", work / "packed.apk", work / "aligned.apk")
        signer = [java, "-jar", tools / "lib/apksigner.jar"]
        signed = work / "signed.apk"
        run(*signer, "sign", "--ks", key, "--ks-key-alias", alias, "--ks-pass", password,
            "--out", signed, work / "aligned.apk")
        certificate_info = subprocess.check_output([str(arg) for arg in (*signer, "verify", "--print-certs", signed)], text=True)
        if args.release and f"certificate SHA-256 digest: {CHESS_LOCAL_CERTIFICATE}" not in certificate_info:
            raise SystemExit("The signing certificate does not match the installed Chess Local release.")
        run(zipalign, "-c", "-P", "16", "4", signed)
        shutil.copy2(signed, output)
    print(output)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path)
    parser.add_argument("--release", action="store_true", help="Build an update signed with the original Chess Local key.")
    parser.add_argument("--emulator", action="store_true")
    parser.add_argument("--application-id", help="Use a separate package ID for local testing.")
    parser.add_argument("--output", type=Path, help="Override the output APK path.")
    build(parser.parse_args())
