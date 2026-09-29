/* Room 26 — public site + admin, backed by Supabase. */
(() => {
const CFG = window.ROOM26_CONFIG || {};
const SECTIONS = [
  {key:"news", name:"News", single:"News"},
  {key:"reviews", name:"Reviews", single:"Album review"},
  {key:"features", name:"Features", single:"Feature"},
  {key:"interviews", name:"Interviews", single:"Interview"},
  {key:"culture", name:"Culture", single:"Culture"},
];
const TONES = ["stone","clay","slate","sand","fog","char"];
const DEFAULT_SETTINGS = {tagline:"Records, rooms and the people who fill them.", strip:"Music · Culture · News", footer:"An independent media company. Reviews, reporting and long reads.", announcement:""};
const TABS = [
  {key:"admin", name:"Posts"}, {key:"admin-edit", name:"Write"}, {key:"admin-media", name:"Images"},
  {key:"admin-team", name:"Team"}, {key:"admin-settings", name:"Site settings"},
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sec = k => SECTIONS.find(s => s.key === k) || SECTIONS[2];
const when = p => new Date(p.published_at || p.created_at);
const fmtDate = d => new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
const fmtShort = d => new Date(d).toLocaleDateString("en-GB",{day:"2-digit",month:"short"});
const fmtSize = b => b > 1048576 ? (b/1048576).toFixed(1)+" MB" : Math.max(1,Math.round(b/1024))+" KB";
const readTime = body => Math.max(1, Math.round(String(body||"").replace(/\[image [^\]]*\]/g,"").split(/\s+/).filter(Boolean).length / 230));
const glyph = p => p.type === "reviews" && p.review?.album ? p.review.album[0] : (p.title||"R")[0];
const validPath = p => /^[A-Za-z0-9/_.-]{3,200}$/.test(String(p||"")) && !String(p).includes("..");
const imgUrl = path => `${CFG.SUPABASE_URL}/storage/v1/object/public/media/${path}`;

$("#today").textContent = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

/* ---------- Setup check ---------- */
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes("YOUR-PROJECT") && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes("YOUR-");
if (!configured || !window.supabase) {
  $("#view").innerHTML = `<div class="setup"><span class="label">Setup needed</span><h2 style="margin:10px 0 12px">Connect Supabase</h2>
    <p>Open <code>config.js</code> and paste your project URL and anon key from Supabase → Project Settings → API. See README.md for the full steps.</p></div>`;
  return;
}

/* Read what an auth email link brought us before supabase-js consumes the hash */
const hashParams = new URLSearchParams(location.hash.slice(1));
const AUTH_LINK = hashParams.get("type");                  // "invite" | "recovery" | "signup" | "magiclink" | null
const AUTH_ERROR = hashParams.get("error_description");

const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
});

const S = {
  posts:[], all:[], media:[], team:[], settings:{...DEFAULT_SETTINGS},
  loaded:false, loadError:false,
  session:null, isAdmin:false, authChecked:false,
  needsPassword: AUTH_LINK === "invite" || AUTH_LINK === "recovery",
  linkError: AUTH_ERROR || "",
  editingId:null, confirm:null, picker:null,
  filter:{status:"all", section:"all", q:""},
};

/* ---------- Data ---------- */
async function loadPublic(){
  const [posts, settings] = await Promise.all([
    sb.from("posts").select("*").eq("status","published").order("published_at",{ascending:false}).limit(500),
    sb.from("site_settings").select("*").eq("id",1).maybeSingle(),
  ]);
  if (posts.error) { S.loadError = true; console.error(posts.error); }
  else S.posts = posts.data;
  if (settings.data) S.settings = {...DEFAULT_SETTINGS, ...settings.data};
  S.loaded = true;
  applySettings();
}
async function loadAdmin(){
  if (!S.isAdmin) return;
  const [all, media, team] = await Promise.all([
    sb.from("posts").select("*").order("updated_at",{ascending:false}).limit(1000),
    sb.from("media").select("*").order("uploaded_at",{ascending:false}).limit(1000),
    sb.from("admins").select("*").order("invited_at",{ascending:true}),
  ]);
  if (!all.error) S.all = all.data;
  if (!media.error) S.media = media.data;
  if (!team.error) S.team = team.data;
}
async function reload(){ await Promise.all([loadPublic(), loadAdmin()]); refreshList(); }

async function checkAdmin(){
  const { data: { session } } = await sb.auth.getSession();
  S.session = session;
  S.isAdmin = false;
  if (session) {
    const { data } = await sb.rpc("is_admin");
    S.isAdmin = !!data;
    if (S.isAdmin) await sb.rpc("claim_admin");
  }
  S.authChecked = true;
  $("#admin-btn").hidden = !S.isAdmin;
}

function applySettings(){
  const s = S.settings;
  $("#tagline").textContent = s.tagline || DEFAULT_SETTINGS.tagline;
  $("#strip-text").textContent = s.strip || DEFAULT_SETTINGS.strip;
  $("#foot-text").textContent = s.footer || DEFAULT_SETTINGS.footer;
  const a = $("#announce"); a.textContent = s.announcement || ""; a.hidden = !s.announcement;
}
function renderNav(route){
  const items = [{key:"home",name:"Latest"}, ...SECTIONS];
  $("#nav").innerHTML = items.map(s => `<a href="#${s.key}" ${route===s.key?'aria-current="page"':''}>${s.name}</a>`).join("");
  $("#foot-nav").innerHTML = SECTIONS.map(s => `<a href="#${s.key}">${s.name}</a>`).join("");
}

/* ================= Public site ================= */
function cover(p, {square=false, score=false}={}){
  const tone = TONES.includes(p.tone) ? p.tone : "stone";
  const img = validPath(p.cover_path) ? `<img src="${esc(imgUrl(p.cover_path))}" alt="" loading="lazy">` : "";
  const sc = score && p.review?.score != null ? `<span class="score-badge">${Number(p.review.score).toFixed(1)}</span>` : "";
  // No image: the logo's roof chevron, centred, instead of a cropped letter
  const mark = `<svg class="mark" viewBox="0 0 40 22" aria-hidden="true"><path d="M3 20 L20 4 L37 20"/></svg>`;
  return `<div class="cover${square?" sq":""}${img?" has-img":""}" data-tone="${tone}" aria-hidden="true">
    ${img || mark}${sc}<span class="cap">${esc(sec(p.type).name)}</span></div>`;
}
document.body.insertAdjacentHTML("afterbegin", `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="r26-chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#8a8a8a"/><stop offset=".6" stop-color="#f0f0f0"/><stop offset="1" stop-color="#9a9a9a"/></linearGradient></defs></svg>`);
// Rows size themselves to how many items there are, so a short row never leaves a gap
const gridStyle = (n, max) => `style="--cols:${Math.max(1, Math.min(n, max))}"`;
const byline = p => `<div class="byline"><b>${esc(p.author||"Room 26")}</b><span>${fmtDate(when(p))}</span><span>${readTime(p.body)} min read</span></div>`;
const kicker = p => `<span class="label">${esc(sec(p.type).single)}</span>`;
const card = p => `<a class="card card-link" href="#p-${p.id}">${cover(p)}${kicker(p)}<h3>${esc(p.title)}</h3>${p.dek?`<p>${esc(p.dek)}</p>`:""}</a>`;
function revCard(p){
  const r = p.review||{};
  return `<a class="rev card-link" href="#p-${p.id}">${cover(p,{square:true,score:true})}
    <span class="artist">${esc(r.artist||"")}</span><span class="album">${esc(r.album||p.title)}</span>
    <span class="label">${esc(r.label||"")}${r.year?" · "+esc(r.year):""}</span></a>`;
}
function emptyState(){
  if (!S.loaded) return `<div class="empty"><span class="label">Loading</span><h2>pulling the latest.</h2></div>`;
  if (S.loadError) return `<div class="empty"><span class="label">Unavailable</span><h2>stories can’t load right now.</h2><p>Refresh the page in a moment.</p></div>`;
  return `<div class="empty"><span class="label">Nothing here yet</span><h2>no stories yet.</h2><p>${S.isAdmin?'Open <a href="#admin-edit" style="border-bottom:1px solid">Admin</a> to publish the first piece.':'Check back soon.'}</p></div>`;
}
function viewHome(){
  const all = S.posts;
  if (!all.length) return emptyState();
  const lead = all.find(p => p.featured) || all[0];
  const rest = all.filter(p => p !== lead);
  const latest = rest.filter(p => p.type !== "news" && p.type !== "reviews").slice(0,3);
  const reviews = all.filter(p => p.type === "reviews" && p !== lead).slice(0,4);
  const news = all.filter(p => p.type === "news" && p !== lead).slice(0,6);
  const side = rest.filter(p => !latest.includes(p) && p.type !== "news" && p.type !== "reviews").slice(0,3);
  return `
  <a class="lead card-link" href="#p-${lead.id}">
    <div>${kicker(lead)}<h2>${esc(lead.title)}</h2>${lead.dek?`<p class="dek">${esc(lead.dek)}</p>`:""}${byline(lead)}</div>
    ${cover(lead,{score:lead.type==="reviews"})}
  </a>
  ${latest.length?`<section class="block"><div class="block-head"><h2>This week</h2></div>
    <div class="grid3${latest.length===1?" single":""}" ${gridStyle(latest.length,3)}>${latest.map(card).join("")}</div></section>`:""}
  ${reviews.length?`<section class="block"><div class="block-head"><h2>Reviews</h2><a class="more" href="#reviews">All reviews</a></div>
    <div class="reviews${reviews.length<=2?" wide":""}" ${gridStyle(reviews.length,4)}>${reviews.map(revCard).join("")}</div></section>`:""}
  ${(news.length||side.length)?`<section class="block split${news.length&&side.length?"":" solo"}">
    <div>${news.length?`<div class="block-head"><h2>The wire</h2><a class="more" href="#news">All news</a></div>
      <ul class="wire">${news.map(p=>`<li><a href="#p-${p.id}"><time>${fmtShort(when(p))}</time><h3>${esc(p.title)}</h3></a></li>`).join("")}</ul>`:""}</div>
    <div>${side.length?`<div class="block-head"><h2>Also read</h2></div><div class="aside-list">${side.map(p=>`<a class="card card-link" href="#p-${p.id}">${kicker(p)}<h3>${esc(p.title)}</h3>${byline(p)}</a>`).join("")}</div>`:""}</div>
  </section>`:""}`;
}
function viewSection(key){
  const s = sec(key);
  const list = S.posts.filter(p => p.type === key);
  const head = `<div class="sec-head"><h2>${s.name}</h2><span class="label">${list.length} ${list.length===1?"piece":"pieces"}</span></div>`;
  if (!list.length) return head + (S.posts.length ? `<div class="empty"><h2>nothing in ${s.name.toLowerCase()} yet.</h2></div>` : emptyState());
  if (key === "reviews") return head + `<div class="reviews">${list.map(revCard).join("")}</div>`;
  return head + `<div class="row-list">${list.map(p=>`<a class="row card-link" href="#p-${p.id}">${cover(p)}<div>${kicker(p)}<h3>${esc(p.title)}</h3>${p.dek?`<p>${esc(p.dek)}</p>`:""}${byline(p)}</div></a>`).join("")}</div>`;
}
function prose(body){
  return String(body||"").trim().split(/\n\s*\n/).map(b => {
    b = b.trim();
    const im = b.match(/^\[image ([A-Za-z0-9/_.-]{3,200})(?:\s+([^\]]*))?\]$/);
    if (im && validPath(im[1])) return `<figure><img src="${esc(imgUrl(im[1]))}" alt="${esc(im[2]||"")}" loading="lazy">${im[2]?`<figcaption>${esc(im[2])}</figcaption>`:""}</figure>`;
    if (b.startsWith("## ")) return `<h2>${esc(b.slice(3))}</h2>`;
    if (b.startsWith("> ")) return `<blockquote>${esc(b.replace(/^>\s?/gm,""))}</blockquote>`;
    return `<p>${esc(b).replace(/\n/g,"<br>")}</p>`;
  }).join("").replace(/<\/p>$/, `<span class="end" aria-hidden="true"></span></p>`);
}
function viewPost(id){
  const p = S.posts.find(x => x.id === id) || (S.isAdmin && S.all.find(x => x.id === id));
  if (!p) return S.loaded ? `<div class="empty"><span class="label">Not found</span><h2>this story isn’t available.</h2><p><a href="#home" style="border-bottom:1px solid">Back to the front page</a></p></div>` : emptyState();
  const r = p.review||{};
  const facts = p.type === "reviews" ? `<div class="facts"><div class="big">${r.score!=null?Number(r.score).toFixed(1):"–"}<span class="label" style="display:block;margin-top:8px">out of 10</span></div>
    <dl><dt>Artist</dt><dd>${esc(r.artist)}</dd><dt>Album</dt><dd><i>${esc(r.album)}</i></dd>${r.label?`<dt>Label</dt><dd>${esc(r.label)}</dd>`:""}${r.year?`<dt>Released</dt><dd>${esc(r.year)}</dd>`:""}</dl></div>` : "";
  const hero = (p.type!=="reviews" || validPath(p.cover_path)) ? `<div class="hero">${cover(p)}</div>` : "";
  document.title = `${p.title} · Room 26`;
  return `<article class="article">
    ${p.status==="draft"?`<p class="note" style="margin-bottom:20px">Draft preview. Only admins can see this.</p>`:""}
    <header>${kicker(p)}<h1>${esc(p.title)}</h1>${p.dek?`<p class="dek">${esc(p.dek)}</p>`:""}${byline(p)}</header>
    ${hero}${facts}
    <div class="prose">${prose(p.body)}</div>
    <div class="art-tools"><a class="more" href="#${p.type}">More ${esc(sec(p.type).name)}</a>${S.isAdmin?`<button class="btn-link" type="button" data-edit="${p.id}">Edit in Admin</button>`:""}</div>
  </article>`;
}

/* ================= Sign-in ================= */
function viewSignIn(){
  if (!S.authChecked) return `<div class="gate"><span class="label">Admin</span><h2>checking your sign-in…</h2></div>`;
  if (S.session && S.needsPassword) return `<div class="gate"><span class="label">${AUTH_LINK==="invite"?"Welcome to Room 26":"Reset password"}</span>
    <h2>${AUTH_LINK==="invite"?"set your password.":"choose a new password."}</h2>
    <p>Signed in as ${esc(S.session.user.email)}. Choose a password you’ll use to sign in from now on.</p>
    <form id="pw-form" novalidate>
      <div class="field"><label for="pw1">New password</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="field"><label for="pw2">Repeat password</label><input id="pw2" type="password" autocomplete="new-password" minlength="8" required></div>
      <p class="err" id="auth-msg" role="alert"></p>
      <div class="actions"><button class="btn" type="submit">Save password</button></div>
    </form></div>`;
  if (S.session && !S.isAdmin) return `<div class="gate"><span class="label">Admin</span><h2>you’re not an admin.</h2>
    <p>You’re signed in as ${esc(S.session.user.email)}, but this account doesn’t have admin access. Ask an existing admin to invite this email address.</p>
    <div class="actions"><button class="btn ghost" type="button" data-signout>Sign out</button></div></div>`;
  return `<div class="gate"><span class="label">Admin sign-in</span><h2>sign in.</h2>
    ${S.linkError?`<p class="err">That link didn’t work: ${esc(S.linkError)}. Ask for a new invite, or reset your password below.</p>`:""}
    <form id="login-form" novalidate>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required></div>
      <p class="err" id="auth-msg" role="alert"></p>
      <div class="actions"><button class="btn" type="submit">Sign in</button><button class="btn-link" type="button" data-forgot>Forgot password?</button></div>
    </form>
    <p class="note">Admin accounts are invite-only. An existing admin can invite you from Admin → Team.</p></div>`;
}
function authMsg(t, ok=false){ const m=$("#auth-msg"); if(m){ m.textContent=t; m.className = ok?"ok":"err"; } }

/* ================= Admin ================= */
function viewAdmin(r){
  if (!S.isAdmin || S.needsPassword) return viewSignIn();
  const head = `<div class="admin-top"><h2>admin</h2><div class="who"><span>Signed in as ${esc(S.session.user.email)}</span><button class="btn-link" type="button" data-signout>Sign out</button></div></div>
    <nav class="tabs" aria-label="Admin">${TABS.map(t=>`<a href="#${t.key}" ${r===t.key?'aria-current="page"':''}>${t.name}</a>`).join("")}</nav>`;
  const body = r==="admin-edit" ? viewEditor() : r==="admin-media" ? viewMedia() : r==="admin-team" ? viewTeam() : r==="admin-settings" ? viewSettings() : viewPosts();
  return head + `<div id="admin-body">${body}</div>`;
}

/* ---- Posts ---- */
function viewPosts(){
  const f = S.filter;
  return `<div class="toolbar">
      <button class="btn" type="button" data-new>New post</button>
      <input id="q" type="search" placeholder="Search headlines and authors" value="${esc(f.q)}" aria-label="Search posts">
      <select id="sec-filter" aria-label="Section"><option value="all">All sections</option>${SECTIONS.map(s=>`<option value="${s.key}" ${f.section===s.key?"selected":""}>${s.name}</option>`).join("")}</select>
      ${["all","published","draft"].map(k=>`<button class="chip" type="button" data-status="${k}" aria-pressed="${f.status===k}">${k==="all"?"All":k==="published"?"Published":"Drafts"}</button>`).join("")}
    </div><div id="list">${postsTable()}</div>`;
}
function postsTable(){
  const f = S.filter, q = f.q.toLowerCase();
  const rows = S.all.filter(p => (f.status==="all" || p.status===f.status) && (f.section==="all"||p.type===f.section)
    && (!q || (p.title||"").toLowerCase().includes(q) || (p.author||"").toLowerCase().includes(q)));
  if (!rows.length) return `<div class="empty" style="padding-block:32px"><h2>no posts match.</h2><p>Try another filter, or write a new post.</p></div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Headline</th><th>Section</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
  ${rows.map(p=>{
    const draft = p.status==="draft";
    const conf = S.confirm==="p:"+p.id ? `<div class="confirm" style="margin-top:8px">Delete “${esc(p.title)}” for good? <button class="btn danger" type="button" data-del-yes="${p.id}">Delete</button><button class="btn ghost" type="button" data-cancel>Keep</button></div>` : "";
    return `<tr><td><div class="ttl">${esc(p.title)}</div><div style="font-size:12px;color:var(--ink-2)">${esc(p.author||"")}</div>${conf}</td>
      <td>${esc(sec(p.type).name)}</td>
      <td>${draft?'<span class="pill">Draft</span>':'<span class="pill live">Live</span>'} ${p.featured?'<span class="pill lead">Lead</span>':""}</td>
      <td class="num">${fmtDate(p.updated_at)}</td>
      <td><div class="ops">
        <button class="btn-link" type="button" data-edit="${p.id}">Edit</button>
        <a class="btn-link" href="#p-${p.id}">${draft?"Preview":"View"}</a>
        ${draft?`<button class="btn-link" type="button" data-publish="${p.id}">Publish</button>`:
          `<button class="btn-link" type="button" data-lead="${p.id}">${p.featured?"Remove lead":"Make lead"}</button>
           <button class="btn-link" type="button" data-unpub="${p.id}">Unpublish</button>`}
        <button class="btn-link danger-link" type="button" data-del="${p.id}">Delete</button>
      </div></td></tr>`;}).join("")}
  </tbody></table></div>`;
}

/* ---- Editor ---- */
function blank(){ return {type:"features",title:"",dek:"",author:"",body:"",tone:"stone",featured:false,cover_path:"",status:"draft",review:{artist:"",album:"",label:"",year:"",score:""}}; }
function currentPost(){
  const src = S.editingId && S.all.find(x => x.id === S.editingId);
  return src ? {...blank(), ...src, review:{...blank().review, ...(src.review||{})}} : blank();
}
function viewEditor(){
  const d = currentPost(), live = d.status==="published" && S.editingId;
  return `<form class="form" id="post-form" novalidate>
    <div class="toolbar" style="margin:0"><span class="label">${S.editingId?(live?"Editing a published post":"Editing a draft"):"New post"}</span>
      ${S.editingId?`<button class="btn-link" type="button" data-new>Start a new post instead</button>`:""}</div>
    <div class="row2">
      <div class="field"><label for="f-type">Section</label><select id="f-type">${SECTIONS.map(s=>`<option value="${s.key}" ${d.type===s.key?"selected":""}>${s.single}</option>`).join("")}</select></div>
      <div class="field"><label for="f-author">Author</label><input id="f-author" value="${esc(d.author)}" placeholder="Name of the writer"></div>
    </div>
    <div class="field"><label for="f-title">Headline</label><input id="f-title" value="${esc(d.title)}" placeholder="Headline" required></div>
    <div class="field"><label for="f-dek">Standfirst</label><input id="f-dek" value="${esc(d.dek)}" placeholder="One or two sentences under the headline"></div>
    <div class="review-fields" id="review-fields" ${d.type==="reviews"?"":"hidden"}>
      <span class="label">Album details</span>
      <div class="row4">
        <div class="field"><label for="f-artist">Artist</label><input id="f-artist" value="${esc(d.review.artist)}"></div>
        <div class="field"><label for="f-album">Album</label><input id="f-album" value="${esc(d.review.album)}"></div>
        <div class="field"><label for="f-label">Label</label><input id="f-label" value="${esc(d.review.label)}"></div>
        <div class="field"><label for="f-year">Year</label><input id="f-year" inputmode="numeric" value="${esc(d.review.year)}"></div>
      </div>
      <div class="field" style="max-width:160px"><label for="f-score">Score out of 10</label><input id="f-score" type="number" min="0" max="10" step="0.1" value="${esc(d.review.score ?? "")}"></div>
    </div>
    <div class="field"><span class="label">Cover image</span>
      <input type="hidden" id="f-cover" value="${esc(d.cover_path||"")}">
      <div class="img-row">
        <div class="cover-prev" id="cover-prev" style="${validPath(d.cover_path)?`background-image:url('${esc(imgUrl(d.cover_path))}')`:""}">${validPath(d.cover_path)?"":"No image. A tone block is used instead."}</div>
        <div class="actions"><button class="btn ghost" type="button" data-upload="cover">Upload image</button><button class="btn ghost" type="button" data-pick="cover">Choose from library</button>
        <button class="btn-link" type="button" data-clear-cover ${validPath(d.cover_path)?"":"hidden"}>Remove</button></div>
      </div>
    </div>
    <div id="picker-slot"></div>
    <div class="field"><label for="f-body">Body</label>
      <div class="actions" style="margin-bottom:4px"><button class="btn-link" type="button" data-upload="body">+ Upload image into text</button><button class="btn-link" type="button" data-pick="body">+ Image from library</button></div>
      <textarea id="f-body" placeholder="Write the piece here.">${esc(d.body)}</textarea>
      <span class="hint">Blank line between paragraphs. ## starts a subheading, &gt; a pull quote. Images appear as [image …] lines; type a caption after the file name.</span></div>
    <div class="field"><span class="label" id="tone-l">Tone (used when there’s no cover image)</span><div class="tones" role="radiogroup" aria-labelledby="tone-l">
      ${TONES.map(t=>`<label title="${t}"><input type="radio" name="tone" id="tone-${t}" value="${t}" ${d.tone===t?"checked":""}><span style="background:var(--tone-${t})"></span></label>`).join("")}</div></div>
    <label class="check"><input type="checkbox" id="f-featured" ${d.featured?"checked":""}> Lead story on the front page</label>
    <div class="actions">
      <button class="btn" type="submit">${live?"Update post":"Publish"}</button>
      <button class="btn ghost" type="button" id="save-draft">${live?"Unpublish to drafts":"Save draft"}</button>
      <span class="status" id="status" role="status"></span>
    </div>
  </form>`;
}
function pickerHTML(){
  if (!S.media.length) return `<div class="picker"><span class="label">Image library</span><p class="note">No images yet. Upload one first.</p><button class="btn-link" type="button" data-close-picker>Close</button></div>`;
  return `<div class="picker"><div class="toolbar" style="margin:0;justify-content:space-between"><span class="label">Choose ${S.picker==="cover"?"a cover":"an image to insert"}</span><button class="btn-link" type="button" data-close-picker>Close</button></div>
    <div class="thumbs">${S.media.map(m=>`<button type="button" data-choose="${esc(m.path)}" title="${esc(m.name)}"><img src="${esc(imgUrl(m.path))}" alt="${esc(m.name)}" loading="lazy"></button>`).join("")}</div></div>`;
}
function readForm(){
  const v = id => $(id).value.trim();
  const type = v("#f-type");
  const data = {type, title:v("#f-title"), dek:v("#f-dek"), author:v("#f-author"), body:$("#f-body").value.trim(),
    tone:(document.querySelector('input[name="tone"]:checked')||{}).value||"stone", featured:$("#f-featured").checked,
    cover_path: validPath(v("#f-cover")) ? v("#f-cover") : null};
  if (type === "reviews") {
    const sc = v("#f-score");
    data.review = {artist:v("#f-artist"), album:v("#f-album"), label:v("#f-label"), year:v("#f-year"), score: sc===""?null:Math.min(10,Math.max(0,Number(sc)))};
  } else data.review = null;
  return data;
}
function setStatus(t){ const el=$("#status"); if(el) el.textContent=t; }
function errText(error){
  if (!error) return "";
  if (error.code === "42501" || /row-level security|permission/i.test(error.message)) return "Your account doesn’t have permission to do that.";
  return error.message || "Something went wrong. Try again.";
}
async function savePost(mode){
  const data = readForm();
  if (!data.title) { setStatus("Add a headline first."); $("#f-title").focus(); return; }
  if (mode==="published" && data.type==="reviews" && (!data.review.artist || !data.review.album)) { setStatus("Reviews need an artist and an album."); return; }
  data.status = mode;
  document.querySelectorAll("#post-form button").forEach(b=>b.disabled=true);
  setStatus(mode==="published"?"Publishing…":"Saving…");
  const q = S.editingId ? sb.from("posts").update(data).eq("id", S.editingId).select().single()
                        : sb.from("posts").insert(data).select().single();
  const { data: row, error } = await q;
  document.querySelectorAll("#post-form button").forEach(b=>b.disabled=false);
  if (error) { setStatus(errText(error)); return; }
  await reload();
  if (mode === "published") { S.editingId = null; location.hash = "p-" + row.id; }
  else { S.editingId = row.id; render(); setStatus("Saved as a draft."); }
}

/* ---- Images ---- */
function usageOf(path){ return S.all.filter(p => p.cover_path===path || String(p.body||"").includes("[image "+path)).length; }
function viewMedia(){
  return `<div class="drop" id="drop">Drop images here, or <button class="btn-link" type="button" data-upload="library" style="font-size:14px;letter-spacing:.04em;text-decoration:underline">choose files</button>. PNG, JPEG, WebP or GIF, up to 20 MB.<div class="status" id="status" role="status" style="margin-top:8px"></div></div>
    <div id="list">${mediaGrid()}</div>`;
}
function mediaGrid(){
  if (!S.media.length) return `<div class="empty" style="padding-block:24px"><h2>no images yet.</h2><p>Upload covers, album art and photos here, then use them in any post.</p></div>`;
  return `<div class="media-grid">${S.media.map(m=>{
    const used = usageOf(m.path);
    const conf = S.confirm==="m:"+m.id ? `<div class="confirm" style="margin:0 12px 12px">${used?`Used in ${used} post${used>1?"s":""}. It will disappear from them. `:""}Delete for good? <button class="btn danger" type="button" data-media-del-yes="${m.id}">Delete</button><button class="btn ghost" type="button" data-cancel>Keep</button></div>` : "";
    return `<div class="media-item"><div class="ph"><img src="${esc(imgUrl(m.path))}" alt="${esc(m.name)}" loading="lazy"></div>
      <div class="meta"><b>${esc(m.name)}</b><span>${fmtSize(m.size||0)} · ${fmtDate(m.uploaded_at)} · ${used?`in ${used} post${used>1?"s":""}`:"not used yet"}</span></div>
      <div class="ops"><button class="btn-link" type="button" data-copy="${esc(m.path)}">Copy image code</button><button class="btn-link danger-link" type="button" data-media-del="${m.id}">Delete</button></div>${conf}</div>`;
  }).join("")}</div>`;
}
async function uploadFiles(files){
  const out = [];
  for (const file of files) {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setStatus(`${file.name} isn’t a PNG, JPEG, WebP or GIF.`); continue; }
    if (file.size > 20*1048576) { setStatus(`${file.name} is over 20 MB. Resize it and try again.`); continue; }
    setStatus(`Uploading ${file.name}…`);
    const ext = ({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"})[file.type];
    const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
    const up = await sb.storage.from("media").upload(path, file, {contentType:file.type, cacheControl:"31536000", upsert:false});
    if (up.error) { setStatus(`Couldn’t upload ${file.name}: ${errText(up.error)}`); continue; }
    const row = await sb.from("media").insert({path, name:file.name, size:file.size, mime:file.type}).select().single();
    if (row.error) { await sb.storage.from("media").remove([path]); setStatus(`Couldn’t save ${file.name}: ${errText(row.error)}`); continue; }
    S.media.unshift(row.data); out.push(path);
    setStatus(`Uploaded ${file.name}.`);
  }
  return out;
}
function applyImage(path, target){
  if (target === "cover") {
    $("#f-cover").value = path;
    const pv = $("#cover-prev"); pv.style.backgroundImage = `url('${imgUrl(path)}')`; pv.textContent = "";
    const clr = document.querySelector("[data-clear-cover]"); if (clr) clr.hidden = false;
  } else if (target === "body") {
    const ta = $("#f-body"), pos = ta.selectionStart ?? ta.value.length;
    const ins = `\n\n[image ${path} Caption]\n\n`;
    ta.value = ta.value.slice(0,pos) + ins + ta.value.slice(pos);
    ta.focus(); const c = pos + ins.indexOf("Caption"); ta.setSelectionRange(c, c+7);
  }
}
async function deleteMedia(id){
  const m = S.media.find(x=>x.id===id); if (!m) return;
  const rm = await sb.storage.from("media").remove([m.path]);
  if (rm.error) { S.confirm=null; refreshList(); setStatus(errText(rm.error)); return; }
  await sb.from("media").delete().eq("id", id);
  S.confirm=null; await reload();
}

/* ---- Team ---- */
function viewTeam(){
  const me = S.session.user.id;
  return `<div class="team-grid">
    <div class="panel"><h3>Admins</h3><ul class="people" style="margin:0">
      ${S.team.map(t=>`<li><span class="pill ${t.accepted_at?"live":""}" style="justify-self:start">${t.accepted_at?"Active":"Invited"}</span>
        <div><div class="n">${esc(t.email)}${t.user_id===me?" (you)":""}</div><div class="s">${t.accepted_at?`Admin since ${fmtDate(t.accepted_at)}`:`Invited ${fmtDate(t.invited_at)} · hasn’t signed in yet`}</div>
        ${S.confirm==="t:"+t.user_id?`<div class="confirm" style="margin-top:8px">Remove admin access for ${esc(t.email)}? <button class="btn danger" type="button" data-team-del-yes="${t.user_id}">Remove</button><button class="btn ghost" type="button" data-cancel>Keep</button></div>`:""}</div>
        ${t.user_id===me?"<span></span>":`<button class="btn-link danger-link" type="button" data-team-del="${t.user_id}">Remove</button>`}</li>`).join("")}
    </ul></div>
    <div class="panel"><h3>Invite an admin</h3>
      <form id="invite-form" class="form" novalidate>
        <div class="field"><label for="invite-email">Email address</label><input id="invite-email" type="email" placeholder="name@example.com" required></div>
        <div class="actions"><button class="btn" type="submit">Send invite</button></div>
        <span class="status" id="status" role="status"></span>
      </form>
      <p class="note">They get an email from Supabase with a link. The link brings them here to set a password, and they’re an admin from then on. If they already have an account, they get admin access straight away.</p>
    </div>
  </div>`;
}
async function sendInvite(){
  const email = $("#invite-email").value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus("Enter a valid email address."); return; }
  setStatus("Sending invite…");
  const { data, error } = await sb.functions.invoke("invite-admin", { body: { email } });
  if (error) {
    let msg = "Couldn’t send the invite.";
    try { msg = (await error.context.json()).error || msg; } catch {}
    setStatus(msg); return;
  }
  await reload(); render();
  setStatus(data.already ? `${email} is already an admin.` : data.emailed ? `Invite sent to ${email}.` : `${email} already had an account and is now an admin.`);
}

/* ---- Settings ---- */
function viewSettings(){
  const s = S.settings;
  return `<form class="form" id="settings-form" style="max-width:720px" novalidate>
    <div class="field"><label for="s-announcement">Announcement bar</label><input id="s-announcement" value="${esc(s.announcement)}" placeholder="Leave empty to hide the bar"><span class="hint">Shows across the top of every page. Good for a new issue, an event or a tour date.</span></div>
    <div class="field"><label for="s-tagline">Tagline under the logo</label><input id="s-tagline" value="${esc(s.tagline)}"></div>
    <div class="field"><label for="s-strip">Top bar text</label><input id="s-strip" value="${esc(s.strip)}"></div>
    <div class="field"><label for="s-footer">Footer text</label><input id="s-footer" value="${esc(s.footer)}"></div>
    <div class="actions"><button class="btn" type="submit">Save settings</button><span class="status" id="status" role="status"></span></div>
  </form>`;
}
async function saveSettings(){
  const v = id => $(id).value.trim();
  const data = {announcement:v("#s-announcement"), tagline:v("#s-tagline"), strip:v("#s-strip"), footer:v("#s-footer"), updated_at:new Date().toISOString()};
  setStatus("Saving…");
  const { error } = await sb.from("site_settings").update(data).eq("id",1);
  if (error) { setStatus(errText(error)); return; }
  S.settings = {...S.settings, ...data}; applySettings(); setStatus("Saved. The site is updated.");
}

/* ================= Routing & events ================= */
function route(){
  const h = location.hash.slice(1);
  if (!h || h.includes("=")) return (AUTH_LINK || S.linkError) ? "admin" : "home";   // auth tokens in the hash
  return h;
}
function render(){
  const r = route();
  let html, navKey = r;
  document.title = "Room 26";
  if (r.startsWith("p-")) { const p = S.posts.find(x=>x.id===r.slice(2)); navKey = p?.type||""; html = viewPost(r.slice(2)); }
  else if (r === "admin" || r.startsWith("admin-")) { navKey = ""; html = viewAdmin(r); }
  else if (SECTIONS.some(s=>s.key===r)) html = viewSection(r);
  else { navKey = "home"; html = viewHome(); }
  renderNav(navKey);
  $("#view").innerHTML = html;
  if (r === "admin-media" && S.isAdmin) wireDrop();
}
function refreshList(){
  const r = route();
  if (r === "admin-edit" || r === "admin-settings" || r === "admin-team" && $("#invite-email")?.value) return;  // don't wipe a form mid-typing
  const list = $("#list");
  if (list && r === "admin") { list.innerHTML = postsTable(); return; }
  if (list && r === "admin-media") { list.innerHTML = mediaGrid(); return; }
  render();
}
let lastRoute = null;
window.addEventListener("hashchange", () => { const r=route(); if (r!==lastRoute){ lastRoute=r; S.confirm=null; S.picker=null; render(); window.scrollTo(0,0);} });

let uploadTarget = null;
async function mutate(promise){ const { error } = await promise; if (error) { alertStatus(errText(error)); return false; } await reload(); return true; }
function alertStatus(msg){ const s=$("#status"); if (s) s.textContent=msg; else { const l=$("#list"); if(l) l.insertAdjacentHTML("afterbegin",`<p class="err" style="margin-bottom:12px">${esc(msg)}</p>`); } }

document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if ("signout" in d) { await sb.auth.signOut(); S.isAdmin=false; S.session=null; S.all=[]; S.team=[]; S.media=[]; $("#admin-btn").hidden=true; location.hash="home"; render(); return; }
  if ("forgot" in d) {
    const email = $("#email").value.trim();
    if (!email) { authMsg("Enter your email first, then click Forgot password."); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + "#admin" });
    authMsg(error ? error.message : "If that address has an account, a reset link is on its way.", !error); return;
  }
  if ("new" in d) { S.editingId=null; if (route()!=="admin-edit") location.hash="admin-edit"; else render(); return; }
  if (d.edit) { S.editingId=d.edit; S.confirm=null; if (route()!=="admin-edit") location.hash="admin-edit"; else render(); window.scrollTo(0,0); return; }
  if (d.status) { S.filter.status=d.status; document.querySelectorAll("[data-status]").forEach(b=>b.setAttribute("aria-pressed", b.dataset.status===d.status)); $("#list").innerHTML=postsTable(); return; }
  if (d.del) { S.confirm="p:"+d.del; refreshList(); return; }
  if ("cancel" in d) { S.confirm=null; route()==="admin-team" ? render() : refreshList(); return; }
  if (d.delYes) { S.confirm=null; if (S.editingId===d.delYes) S.editingId=null; await mutate(sb.from("posts").delete().eq("id", d.delYes)); return; }
  if (d.lead) { const p=S.all.find(x=>x.id===d.lead); if (p) await mutate(sb.from("posts").update({featured:!p.featured}).eq("id",p.id)); return; }
  if (d.unpub) { await mutate(sb.from("posts").update({status:"draft"}).eq("id", d.unpub)); return; }
  if (d.publish) { await mutate(sb.from("posts").update({status:"published"}).eq("id", d.publish)); return; }
  if (t.id==="save-draft") { savePost("draft"); return; }
  if (d.upload) { uploadTarget = d.upload; const fi=$("#file-in"); fi.multiple = d.upload==="library"; fi.value=""; fi.click(); return; }
  if (d.pick) { S.picker=d.pick; $("#picker-slot").innerHTML=pickerHTML(); return; }
  if ("closePicker" in d) { S.picker=null; $("#picker-slot").innerHTML=""; return; }
  if (d.choose) { applyImage(d.choose, S.picker); S.picker=null; $("#picker-slot").innerHTML=""; return; }
  if ("clearCover" in d) { $("#f-cover").value=""; const pv=$("#cover-prev"); pv.style.backgroundImage=""; pv.textContent="No image. A tone block is used instead."; t.hidden=true; return; }
  if (d.copy) {
    const code = `[image ${d.copy} Caption]`;
    try { await navigator.clipboard.writeText(code); t.textContent="Copied"; } catch { t.textContent=code; }
    setTimeout(()=>{ t.textContent="Copy image code"; }, 2500); return;
  }
  if (d.mediaDel) { S.confirm="m:"+d.mediaDel; refreshList(); return; }
  if (d.mediaDelYes) { deleteMedia(d.mediaDelYes); return; }
  if (d.teamDel) { S.confirm="t:"+d.teamDel; render(); return; }
  if (d.teamDelYes) { S.confirm=null; await mutate(sb.from("admins").delete().eq("user_id", d.teamDelYes)); render(); return; }
});

document.addEventListener("submit", async e => {
  e.preventDefault();
  const id = e.target.id;
  if (id==="post-form") savePost("published");
  if (id==="settings-form") saveSettings();
  if (id==="invite-form") sendInvite();
  if (id==="login-form") {
    const email=$("#email").value.trim(), password=$("#password").value;
    if (!email || !password) { authMsg("Enter your email and password."); return; }
    authMsg("Signing in…", true);
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { authMsg(error.message === "Invalid login credentials" ? "That email and password don’t match." : error.message); return; }
    S.linkError = ""; await checkAdmin(); await loadAdmin(); render();
  }
  if (id==="pw-form") {
    const a=$("#pw1").value, b=$("#pw2").value;
    if (a.length < 8) { authMsg("Use at least 8 characters."); return; }
    if (a !== b) { authMsg("The two passwords don’t match."); return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { authMsg(error.message); return; }
    S.needsPassword = false; await checkAdmin(); await loadAdmin();
    history.replaceState(null, "", location.pathname + "#admin"); lastRoute = "admin"; render();
  }
});
document.addEventListener("change", async e => {
  if (e.target.id==="f-type") $("#review-fields").hidden = e.target.value!=="reviews";
  if (e.target.id==="sec-filter") { S.filter.section=e.target.value; $("#list").innerHTML=postsTable(); }
  if (e.target.id==="file-in") {
    const files = [...e.target.files]; if (!files.length) return;
    const paths = await uploadFiles(files);
    if (paths.length && uploadTarget && uploadTarget!=="library") applyImage(paths[0], uploadTarget);
    if (route()==="admin-media") $("#list").innerHTML = mediaGrid();
  }
});
document.addEventListener("input", e => { if (e.target.id==="q") { S.filter.q=e.target.value; $("#list").innerHTML=postsTable(); } });
function wireDrop(){
  const dz = $("#drop"); if (!dz) return;
  dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", async ev => { ev.preventDefault(); dz.classList.remove("over"); await uploadFiles([...ev.dataTransfer.files]); $("#list").innerHTML = mediaGrid(); });
}

sb.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") { S.needsPassword = true; render(); }
});

/* ---------- Boot ---------- */
lastRoute = route(); render();
(async () => {
  await checkAdmin();
  await Promise.all([loadPublic(), loadAdmin()]);
  if (AUTH_LINK || S.linkError) { history.replaceState(null, "", location.pathname + "#admin"); lastRoute = "admin"; }
  render();
})();
})();
