import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { httpsCallable } from "firebase/functions";
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, ensureAuth, firebaseConfigured, functions, storage } from "./firebase";

type Member = { uid: string; name: string; role: string };
type Expense = {
  id: string; name: string; amount: number; category: string; payerUid: string;
  splitWith: string[]; createdBy: string; receiptUrl?: string; createdAt?: any;
};
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const categories = ["🍜 餐飲","🛍️ 購物","🚆 交通","🏨 住宿","🎡 門票娛樂","☕ 飲料點心","🎁 伴手禮","📦 其他"];

export default function App() {
  const [uid,setUid] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [roomId,setRoomId] = useState("");
  const [joined,setJoined] = useState(false);
  const [inviteToken,setInviteToken] = useState("");
  const [room,setRoom] = useState<any>(null);
  const [members,setMembers] = useState<Member[]>([]);
  const [expenses,setExpenses] = useState<Expense[]>([]);
  const [myName,setMyName] = useState("");
  const [title,setTitle] = useState("日本旅行");
  const [password,setPassword] = useState("");
  const [maxMembers,setMaxMembers] = useState(2);
  const [rate,setRate] = useState("0.22");
  const [item,setItem] = useState("");
  const [amount,setAmount] = useState("");
  const [category,setCategory] = useState(categories[0]);
  const [payer,setPayer] = useState("");
  const [splitWith,setSplitWith] = useState<string[]>([]);
  const [receipt,setReceipt] = useState<File|null>(null);
  const [inviteUrl,setInviteUrl] = useState("");
  const [showInvite,setShowInvite] = useState(false);
  const [filter,setFilter] = useState("all");

  const url = new URL(window.location.href);
  const queryRoom = url.searchParams.get("room") || "";
  const queryInvite = url.searchParams.get("invite") || "";
  const member = members.find(m=>m.uid===uid);
  const isOwner = member?.role === "owner";
  const fx = Math.max(0.0001,Number(rate)||0.22);

  useEffect(()=>{ ensureAuth().then(u=>setUid(u.uid)).catch(e=>setError(e.message)); },[]);
  useEffect(()=>{
    if (!uid) return;
    if (queryRoom && queryInvite) { setRoomId(queryRoom); setInviteToken(queryInvite); }
    else {
      const saved = localStorage.getItem("japan-trip-room");
      if(saved) setRoomId(saved);
    }
  },[uid]);

  useEffect(()=>{
    if(!uid || !roomId) return;
    const unsubRoom = onSnapshot(doc(db,"rooms",roomId),s=>{
      if(s.exists()){setRoom(s.data());setRate(String(s.data().rate||0.22));}
      else setRoom(null);
    },e=>setError("讀取房間失敗："+e.message));
    const unsubMembers = onSnapshot(collection(db,"rooms",roomId,"members"),s=>{
      const list=s.docs.map(d=>d.data() as Member);setMembers(list);
      const me=list.find(m=>m.uid===uid);if(me)setMyName(me.name);
      if(list.length) setPayer(old=>old||uid);
      setSplitWith(old=>Array.from(new Set([...old,...list.map(m=>m.uid)])));
    },e=>setError("讀取成員失敗："+e.message));
    const unsubExpenses = onSnapshot(query(collection(db,"rooms",roomId,"expenses"),orderBy("createdAt","desc")),s=>{
      setExpenses(s.docs.map(d=>({id:d.id,...d.data()} as Expense)));
    },e=>setError("讀取帳目失敗："+e.message));
    return ()=>{unsubRoom();unsubMembers();unsubExpenses();};
  },[uid,roomId,joined]);

  useEffect(()=>{
    if(room && member) localStorage.setItem("japan-trip-room",roomId);
  },[room,member,roomId]);

  const stats = useMemo(()=>{
    const paid:Record<string,number>={},share:Record<string,number>={};
    members.forEach(m=>{paid[m.uid]=0;share[m.uid]=0;});
    let total=0;
    expenses.forEach(e=>{
      total+=e.amount;paid[e.payerUid]=(paid[e.payerUid]||0)+e.amount;
      const people=e.splitWith||[];
      if(people.length) people.forEach(id=>share[id]=(share[id]||0)+e.amount/people.length);
    });
    return {paid,share,total};
  },[expenses,members]);

  const settlement = useMemo(()=>{
    let balances=members.map(m=>({uid:m.uid,name:m.name,balance:(stats.paid[m.uid]||0)-(stats.share[m.uid]||0)}));
    const debtors=balances.filter(x=>x.balance<-.005).map(x=>({...x,amount:-x.balance}));
    const creditors=balances.filter(x=>x.balance>.005).map(x=>({...x,amount:x.balance}));
    const result:{from:string;to:string;amount:number}[]=[];
    let i=0,j=0;
    while(i<debtors.length&&j<creditors.length){
      const v=Math.min(debtors[i].amount,creditors[j].amount);
      if(v>.005)result.push({from:debtors[i].name,to:creditors[j].name,amount:v});
      debtors[i].amount-=v;creditors[j].amount-=v;
      if(debtors[i].amount<.005)i++;if(creditors[j].amount<.005)j++;
    }
    return result;
  },[members,stats]);

  async function createRoom(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      await ensureAuth();
      const call=httpsCallable(functions,"createRoom");
      const result:any=await call({title,name:myName,password,maxMembers});
      const {roomId:newId,inviteToken:token}=result.data;
      setRoomId(newId);setInviteToken(token);setJoined(true);
      const link=`${location.origin}${location.pathname}?room=${newId}&invite=${token}`;
      setInviteUrl(link);setShowInvite(true);
      history.replaceState(null,"",`?room=${newId}&invite=${token}`);
    }catch(e:any){setError(e.message||"建立房間失敗");}
    finally{setBusy(false);}
  }

  async function joinRoom(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{
      await ensureAuth();
      const call=httpsCallable(functions,"joinRoom");
      await call({roomId,inviteToken,password,name:myName});
      localStorage.setItem("japan-trip-room",roomId);
      setError("");history.replaceState(null,"",`?room=${roomId}&invite=${inviteToken}`);
    }catch(e:any){setError(e.message||"加入房間失敗");}
    finally{setBusy(false);}
  }

  async function addExpense(e:FormEvent){
    e.preventDefault();if(!item.trim()||Number(amount)<=0||!payer||!splitWith.length)return;
    setBusy(true);setError("");
    try{
      let receiptUrl="";
      if(receipt){
        const fileRef=ref(storage,`rooms/${roomId}/receipts/${Date.now()}-${receipt.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`);
        await uploadBytes(fileRef,receipt,{contentType:receipt.type});
        receiptUrl=await getDownloadURL(fileRef);
      }
      await addDoc(collection(db,"rooms",roomId,"expenses"),{
        name:item.trim(),amount:Number(amount),category,payerUid:payer,splitWith,
        createdBy:uid,receiptUrl:receiptUrl||null,createdAt:serverTimestamp()
      });
      setItem("");setAmount("");setReceipt(null);
      const input=document.getElementById("receipt-input") as HTMLInputElement|null;if(input)input.value="";
    }catch(e:any){setError("新增消費失敗："+e.message);}
    finally{setBusy(false);}
  }

  async function changeRate(value:string){
    setRate(value);
    if(!room || Number(value)<=0)return;
    try{await updateDoc(doc(db,"rooms",roomId),{rate:Number(value),updatedAt:serverTimestamp()});}
    catch(e:any){setError("匯率更新失敗："+e.message);}
  }
  async function copyInvite(){
    const link=inviteUrl||`${location.origin}${location.pathname}?room=${roomId}&invite=${inviteToken}`;
    try{await navigator.clipboard.writeText(link);alert("邀請連結已複製！把連結和房間密碼傳給朋友。");}
    catch{prompt("請複製邀請連結：",link);}
  }
  async function removeExpense(id:string){if(!confirm("確定刪除這筆消費？"))return;await deleteDoc(doc(db,"rooms",roomId,"expenses",id));}
  async function editExpense(exp:Expense){
    const next=prompt("修改項目名稱：",exp.name);if(next===null||!next.trim())return;
    const val=prompt("修改日幣金額：",String(exp.amount));if(val===null||Number(val)<=0)return;
    await updateDoc(doc(db,"rooms",roomId,"expenses",exp.id),{name:next.trim(),amount:Number(val)});
  }
  function leaveRoom(){
    localStorage.removeItem("japan-trip-room");setJoined(false);setRoomId("");setRoom(null);setMembers([]);setExpenses([]);
    setInviteToken("");setPassword("");history.replaceState(null,"",location.pathname);
  }

  if(!firebaseConfigured) return <main className="shell"><header><span className="flag">🇯🇵</span><h1>日本旅遊分帳所</h1><p>多人即時同步旅遊帳本</p></header><section className="card"><h2>尚未設定 Firebase</h2><p>請依照專案內 README.md 的步驟建立 Firebase 專案，並填入 .env.local 設定後再啟動網站。</p></section></main>;

  if(!uid) return <main className="shell"><div className="card center">正在準備你的旅遊帳本…</div></main>;

  if(!room || !member){
    const isJoining=Boolean(roomId&&inviteToken);
    return <main className="shell">
      <header><span className="flag">🇯🇵</span><h1>日本旅遊分帳所</h1><p>一起旅行，花費清清楚楚。</p></header>
      <section className="card">
        <h2>{isJoining?"加入朋友的旅遊帳本":"建立新的旅遊帳本"}</h2>
        <form onSubmit={isJoining?joinRoom:createRoom} className="stack">
          {!isJoining&&<label>旅程名稱<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：大阪六天五夜"/></label>}
          <label>你的暱稱<input required maxLength={20} value={myName} onChange={e=>setMyName(e.target.value)} placeholder="例如：小星"/></label>
          <label>房間密碼<input required minLength={6} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 6 個字元"/></label>
          {!isJoining&&<label>最多加入人數<select value={maxMembers} onChange={e=>setMaxMembers(Number(e.target.value))}><option value={1}>1 人</option><option value={2}>2 人</option><option value={3}>3 人</option><option value={4}>4 人</option></select></label>}
          <button className="primary" disabled={busy}>{busy?"處理中…":isJoining?"🔐 驗證並加入房間":"✈️ 建立旅遊帳本"}</button>
        </form>
        {isJoining&&<button className="linkbutton" onClick={()=>{setRoomId("");setInviteToken("");history.replaceState(null,"",location.pathname);}}>改為建立自己的帳本</button>}
        {!isJoining&&<p className="hint">建立後會產生專屬邀請連結。把連結和房間密碼傳給同行朋友即可加入。</p>}
        {error&&<p className="error">{error}</p>}
      </section>
      <footer>每個人用自己的手機加入，帳目即時同步。</footer>
    </main>;
  }

  const visibleExpenses=expenses.filter(e=>filter==="all"||e.category===filter);
  return <main className="shell">
    <header className="insideHeader"><div><span className="eyebrow">JAPAN TRIP SHARED WALLET</span><h1>{room.title||"日本旅行"}</h1><p>🇯🇵 {members.length}/{room.maxMembers} 位旅伴 · 即時同步中</p></div><button className="outline small" onClick={()=>setShowInvite(!showInvite)}>邀請旅伴</button></header>
    {showInvite&&<section className="card"><div className="row between"><h2>邀請朋友加入</h2><button className="iconbtn" onClick={()=>setShowInvite(false)}>✕</button></div><p className="hint">把下面連結和建立房間時設定的密碼傳給朋友。連結請只分享給同行者。</p><div className="qr"><QRCodeSVG value={inviteUrl||`${location.origin}${location.pathname}?room=${roomId}&invite=${inviteToken}`} size={156}/></div><button className="primary full" onClick={copyInvite}>複製邀請連結</button><p className="hint">房間密碼不會放在邀請網址裡，請另外傳送。</p></section>}
    {error&&<div className="errorbox">{error}</div>}
    <section className="summaryGrid">
      <div className="summary"><span>旅行總花費</span><strong>¥{money(stats.total)}</strong><small>約 NT${money(stats.total*fx)}</small></div>
      <div className="summary"><span>消費筆數</span><strong>{expenses.length}</strong><small>{members.length} 位旅伴</small></div>
    </section>
    <section className="card"><div className="row between"><h2>旅伴清單</h2><span className="tag">{members.length} / {room.maxMembers} 人</span></div><div className="members">{members.map(m=><div className="member" key={m.uid}><span className="avatar">{m.name.slice(0,1)}</span><span>{m.name}{m.role==="owner"?" · 建立者":""}{m.uid===uid?"（你）":""}</span></div>)}</div></section>
    <section className="card">
      <h2>新增一筆消費</h2>
      <form onSubmit={addExpense} className="stack">
        <label>消費項目<input required value={item} onChange={e=>setItem(e.target.value)} placeholder="例如：章魚燒、藥妝、車票"/></label>
        <div className="two"><label>金額（日圓 ¥）<input required type="number" min="1" step="1" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="輸入日幣金額"/></label><label>消費類別<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div>
        <label>誰先付款？<select required value={payer} onChange={e=>setPayer(e.target.value)}>{members.map(m=><option key={m.uid} value={m.uid}>{m.name}</option>)}</select></label>
        <div><div className="labeltitle">這筆費用由誰分攤？</div><div className="checkgrid">{members.map(m=><label className="check" key={m.uid}><input type="checkbox" checked={splitWith.includes(m.uid)} onChange={e=>setSplitWith(old=>e.target.checked?[...old,m.uid]:old.filter(x=>x!==m.uid))}/>{m.name}</label>)}</div><p className="hint">只勾選有使用／需要分攤的人，系統會平均分攤。</p></div>
        <label>收據照片（選填）<input id="receipt-input" type="file" accept="image/*" capture="environment" onChange={e=>setReceipt(e.target.files?.[0]||null)}/></label>
        {receipt&&<p className="hint">已選擇：{receipt.name}</p>}
        <button className="primary" disabled={busy||!splitWith.length}>{busy?"上傳／儲存中…":"＋ 新增消費並同步"}</button>
      </form>
    </section>
    <section className="card">
      <div className="row between"><h2>消費明細</h2><span className="tag">{expenses.length} 筆</span></div>
      <select className="filter" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部類別</option>{categories.map(c=><option key={c} value={c}>{c}</option>)}</select>
      {visibleExpenses.length===0?<p className="empty">目前還沒有消費紀錄，新增第一筆吧！</p>:<div className="expenseList">{visibleExpenses.map(e=>{
        const payerName=members.find(m=>m.uid===e.payerUid)?.name||"已離開成員";
        const splitNames=(e.splitWith||[]).map(id=>members.find(m=>m.uid===id)?.name||"成員").join("、");
        return <article className="expense" key={e.id}><div className="row between alignstart"><div><b>{e.name}</b><div className="meta">{e.category} · {payerName} 付款</div></div><strong>¥{money(e.amount)}</strong></div><div className="meta">分攤：{splitNames||"未指定"} · 每人約 ¥{money(e.amount/Math.max(1,e.splitWith.length))}</div>{e.receiptUrl&&<a className="receiptLink" href={e.receiptUrl} target="_blank" rel="noreferrer">📷 查看收據</a>}<div className="row actions"><button className="linkbutton" onClick={()=>editExpense(e)}>修改金額／項目</button><button className="linkbutton danger" onClick={()=>removeExpense(e.id)}>刪除</button></div></article>;
      })}</div>}
    </section>
    <section className="card">
      <h2>每個人應付多少？</h2>
      <div className="ratebox"><label>匯率（1 日圓＝台幣）<input type="number" min="0.0001" step="0.001" value={rate} onChange={e=>changeRate(e.target.value)}/></label><span>目前約 NT${money(stats.total*fx)}</span></div>
      <div className="personStats">{members.map(m=><div className="personStat" key={m.uid}><b>{m.name}</b><div>應分攤 <strong>¥{money(stats.share[m.uid]||0)}</strong></div><div>已付款 <strong>¥{money(stats.paid[m.uid]||0)}</strong></div><small>約 NT${money((stats.share[m.uid]||0)*fx)}</small></div>)}</div>
      <h3>最後結帳</h3>
      {settlement.length===0?<p className="settled">🎉 目前帳目已平衡，不用互相轉帳。</p>:settlement.map((s,i)=><div className="settle" key={i}><b>{s.from}</b><span>應轉給</span><b>{s.to}</b><strong>¥{money(s.amount)}</strong><small>約 NT${money(s.amount*fx)}</small></div>)}
    </section>
    <div className="bottomActions"><button className="outline" onClick={()=>{const lines=[room.title,"日本旅遊分帳明細",`匯率：${fx}`,"",...expenses.map(e=>`${e.name}, ¥${e.amount}, 付款:${members.find(m=>m.uid===e.payerUid)?.name||""}, 分攤:${e.splitWith.map(id=>members.find(m=>m.uid===id)?.name||"").join("/")}`),"",`總花費 ¥${stats.total}`,...members.map(m=>`${m.name}:應分攤¥${Math.round(stats.share[m.uid]||0)},已付¥${Math.round(stats.paid[m.uid]||0)}`),...settlement.map(s=>`${s.from} 轉給 ${s.to} ¥${Math.round(s.amount)}`)];const blob=new Blob(["\uFEFF"+lines.join("\n")],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="日本旅遊分帳.csv";a.click();URL.revokeObjectURL(a.href);}}>匯出帳單 CSV</button><button className="linkbutton" onClick={leaveRoom}>切換／離開此帳本</button></div>
    <footer>日本旅遊分帳所 · 同行記帳，旅途更輕鬆</footer>
  </main>;
}