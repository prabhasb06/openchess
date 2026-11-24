import React, { useEffect, useRef, useState } from "react";
import { GitBranch, X } from "lucide-react";
import "./variations.css";

const title = (node) => `${node.before.split(" ")[5]}${node.before.split(" ")[1] === "w" ? "." : "..."} ${node.san}`;
function lines(tree) {
  const rows = [];
  function visit(parent, prefix = [], depth = 0) {
    const children = tree.nodes[parent].children;
    for (let i = 0; i < children.length; i++) {
      const first = children[i];
      if (parent === "root" || i > 0) {
        const ids = [];
        for (let id = first; id; id = tree.nodes[id].children[0]) ids.push(id);
        rows.push({ first, ids, depth: parent === "root" && i === 0 ? 0 : depth + (i > 0 ? 1 : 0),
          label: parent === "root" ? i === 0 ? "Mainline" : "Alternative first move" : "After " + prefix.slice(-3).map(id => title(tree.nodes[id])).join(" ") });
      }
      visit(first, [...prefix, first], depth + (i > 0 ? 1 : 0));
    }
  }
  visit("root"); return rows;
}

/** Local mobile PGN variation controls. Native tree layout has not been captured. */
export function MobileAnalysisVariations({ controller: c }) {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(false),
    [text, setText] = useState(""), [nag, setNag] = useState(0), [notice, setNotice] = useState("");
  const panel = useRef(null), tree = c.analysis, cursor = tree?.cursor || "root", node = tree?.nodes[cursor];
  useEffect(() => { setText(node?.comment || ""); setNag(node?.nags?.[0] || 0); setConfirm(false); setNotice(""); }, [cursor, open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    panel.current?.querySelector("button")?.focus({preventScroll:true});
    const close = () => confirm ? setConfirm(false) : setOpen(false);
    const back = event => { if (!event.defaultPrevented) { event.preventDefault(); close(); } };
    const key = event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const controls = [...panel.current.querySelectorAll("button,textarea,select")].filter(n => !n.disabled),first=controls[0],last=controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus({preventScroll:true});}
        else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus({preventScroll:true});}
      }
    };
    window.addEventListener("chess-native-back", back);document.addEventListener("keydown", key);
    return () => { window.removeEventListener("chess-native-back",back);document.removeEventListener("keydown",key);if(previous?.isConnected)previous.focus({preventScroll:true}); };
  }, [open, confirm]);
  if (!tree) return null;
  return <>
    <button onClick={() => setOpen(true)} aria-label={`Analysis lines, ${tree.variations} variations`}><GitBranch/><span>Lines{tree.variations ? ` (${tree.variations})` : ""}</span></button>
    {open && <div className="am-variations-cover" onPointerDown={event => {if(event.target===event.currentTarget)setOpen(false);}}>
      <section className="am-variations-sheet" role="dialog" aria-modal="true" aria-label="Analysis variations" ref={panel}>
        <header><h2>Analysis Lines</h2><button onClick={()=>setOpen(false)} aria-label="Close analysis lines"><X/></button></header>
        {confirm ? <div className="am-variation-confirm"><h3>Delete this move and its continuations?</h3><p>{node && title(node)} and the lines following it will be removed from this analysis. Your archived game stays saved.</p><button className="am-danger" onClick={()=>{c.removeAnalysisNode(cursor);setConfirm(false);}}>Delete continuation</button><button onClick={()=>setConfirm(false)}>Keep line</button></div> : <>
          <div className="am-variation-list">
            <button className={`am-variation-start ${cursor==="root"?"current":""}`} onClick={()=>c.selectAnalysisNode("root")}>Starting Position</button>
            {lines(tree).map(row=><div className="am-variation-row" key={row.first} style={{marginLeft:Math.min(row.depth,3)*9}}>
              <h3 title={row.label}>{row.label}</h3><div>{row.ids.map(id=><button key={id} aria-label={`Variation move ${title(tree.nodes[id])}`} aria-current={cursor===id?"step":undefined} className={cursor===id?"current":""} onClick={()=>c.selectAnalysisNode(id)}>{title(tree.nodes[id])}{tree.nodes[id].nags?.[0] ? ["","!","?","!!","??","!?","?!"][tree.nodes[id].nags[0]] || ` $${tree.nodes[id].nags[0]}` : tree.nodes[id].suffix}{tree.nodes[id].comment && <span className="am-note-dot" aria-label="Has comment"> •</span>}</button>)}</div>
            </div>)}
            {!tree.path.length && <p>Play a move to begin. Return to an earlier position and play a different move to keep both lines.</p>}
          </div>
          <div className="am-variation-editor"><h3>{cursor==="root"?"Starting position":node&&title(node)}</h3>
            <label>Comment<textarea aria-label="Position comment" maxLength={10000} value={text} onChange={e=>setText(e.target.value)} placeholder="Add your analysis"/></label>
            <label>Move annotation<select aria-label="Move annotation" value={nag} disabled={cursor==="root"} onChange={e=>setNag(Number(e.target.value))}>{[[0,"None"],[1,"! Good move"],[2,"? Mistake"],[3,"!! Brilliant"],[4,"?? Blunder"],[5,"!? Interesting"],[6,"?! Dubious"],...(nag>6?[[nag,`$${nag}`]]:[])].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <div className="am-variation-buttons"><button className="am-primary" onClick={()=>{try{c.annotateAnalysisNode(cursor,{text,nag:cursor==="root"?undefined:nag});setNotice("Comment saved");}catch(e){setNotice(e.message);}}}>Save comment</button><button className="am-surface" onClick={()=>setOpen(false)}>View Board</button></div>
            {cursor!=="root"&&<div className="am-variation-management"><button onClick={()=>{c.promoteAnalysisNode(cursor);setNotice("Mainline updated; other lines kept");}}>Promote to mainline</button><button className="am-danger" onClick={()=>setConfirm(true)}>Delete from this move</button></div>}
            {notice&&<p role="status">{notice}</p>}
          </div>
        </>}
      </section>
    </div>}
  </>;
}
