"""Build the emulator executable from the project's verified Stockfish 18 distribution."""
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "build" / "emulator-engine"
SOURCE = OUT / "stockfish" / "src"

def build():
    record = json.loads((ROOT / "engine/stockfish.json").read_text())
    archive = ROOT / "engine/stockfish-android-armv8.tar"
    arm = (ROOT / "engine/libstockfish.so").read_bytes()
    if hashlib.sha256(arm).hexdigest() != record["binarySha256"] or hashlib.sha256(archive.read_bytes()).hexdigest() != record["archiveSha256"]:
        raise ValueError("Stockfish distribution checksum mismatch")
    OUT.mkdir(exist_ok=True, parents=True)
    with tarfile.open(archive) as tar:
        tar.extractall(OUT, members=[m for m in tar if m.isfile() and m.name.startswith("stockfish/src/")], filter="data")
    # File offsets in the checksum-pinned upstream ELF. The network names contain their SHA-256 prefixes.
    for digest, offset, size in [("c288c895ea92", 109168, 108919594), ("37f18f62d772", 109028784, 3519630)]:
        network = arm[offset:offset + size]
        if not hashlib.sha256(network).hexdigest().startswith(digest):
            raise ValueError("Invalid embedded network " + digest)
        (SOURCE / f"nn-{digest}.nnue").write_bytes(network)
    ndk = Path(os.environ.get("OPENCHESS_NDK", ROOT / "toolchain/android-ndk-r30"))
    executable = "clang++.exe" if os.name == "nt" else "clang++"
    compiler = next(ndk.glob("toolchains/llvm/prebuilt/*/bin/" + executable), None)
    if compiler is None:
        raise SystemExit("Set OPENCHESS_NDK to your local Android NDK r30.")
    flags = [str(compiler), "--target=x86_64-linux-android26", "-std=c++17", "-O3", "-DNDEBUG", "-DIS_64BIT", "-DUSE_SSE2", "-DUSE_PTHREADS", "-fno-exceptions", "-fPIE"]
    def compile_one(src):
        obj = OUT / (src.stem + ".o")
        subprocess.run([*flags, "-c", str(src), "-o", str(obj)], cwd=SOURCE, check=True)
        return obj
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        objects = list(pool.map(compile_one, sorted(SOURCE.rglob("*.cpp"))))
    subprocess.run([*flags, *map(str, objects), "-static-libstdc++", "-pie", "-s", "-Wl,-z,max-page-size=16384", "-o", str(OUT / "libstockfish.so")], check=True)

if __name__ == "__main__":
    build()
