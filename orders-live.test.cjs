const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function harness(responses){
 const elements={};let renders=0;
 const content={set innerHTML(value){this.value=value;renders++;},get innerHTML(){return this.value;}};
 const stats=[{textContent:''},{textContent:''},{textContent:''}];
 const document={
  addEventListener(){},
  querySelector(selector){if(selector==='#admin-content')return content;if(selector==='#editor')return {open:false};return elements[selector]||=({hidden:false,innerHTML:'',textContent:'',classList:{add(){},remove(){}}});},
  querySelectorAll(){return stats;}
 };
 const context=vm.createContext({document,window:{},setTimeout(){},clearTimeout(){},fetch:async()=>{
  const result=responses.shift();if(!result)throw new Error('Unexpected fetch');
  return {ok:result.status===200,status:result.status,json:async()=>result.body};
 }});
 const source=fs.readFileSync('public/admin.js','utf8').split("document.addEventListener('click'")[0];
 vm.runInContext(`${source}\nglobalThis.hooks={load,render,syncOrders,getOrders:()=>db?.orders,setTab:value=>tab=value};`,context);
 return {hooks:context.hooks,content,stats,document,get renders(){return renders;},elements};
}
const base=()=>({products:[],bundles:[],settings:{},orders:[]});
const order={id:'order-1',created:'2026-10-03T08:00:00Z',status:'New request',name:'Customer',mode:'pickup',items:[],total:500,savings:0,deliveryFee:0};

test('new order appears automatically without a manual refresh',async()=>{
 const app=harness([{status:200,body:base()},{status:200,body:{...base(),orders:[order]}},{status:200,body:{...base(),orders:[order]}}]);
 await app.hooks.load();const before=app.renders;
 await app.hooks.syncOrders();
 assert.equal(app.hooks.getOrders()[0].id,'order-1');
 assert.match(app.elements['#tab-content'].innerHTML,/order-1/);
 assert.equal(app.renders,before+1);
 await app.hooks.syncOrders();
 assert.equal(app.renders,before+1);
});

test('order polling pauses on tabs that do not show live orders or prize entries',async()=>{
 const app=harness([{status:200,body:base()},{status:200,body:{...base(),orders:[order]}}]);
 await app.hooks.load();app.hooks.setTab('products');const before=app.renders;
 await app.hooks.syncOrders();
 assert.equal(app.renders,before);
 assert.equal(app.stats[0].textContent,'');
});

test('hidden admin tab waits until visible before refreshing',async()=>{
 const app=harness([{status:200,body:base()},{status:200,body:{...base(),orders:[order]}}]);
 await app.hooks.load();app.document.hidden=true;
 await app.hooks.syncOrders();
 assert.equal(app.hooks.getOrders().length,0);
 app.document.hidden=false;
 await app.hooks.syncOrders();
 assert.equal(app.hooks.getOrders().length,1);
});

test('admin order card shows both contact numbers as call links',async()=>{
 const withContacts={...order,mobile:'+919876543210',alternateMobile:'+919123456780'};
 const app=harness([{status:200,body:{...base(),orders:[withContacts]}}]);
 await app.hooks.load();
 assert.match(app.elements['#tab-content'].innerHTML,/tel:\+919876543210/);
 assert.match(app.elements['#tab-content'].innerHTML,/tel:\+919123456780/);
});

test('prize settings show date and time pickers with a DD/MM/YY preview',async()=>{
 const offer={id:'diwali-special-prizes-2026',enabled:false,title:'Diwali Special Prizes',drawAt:'2026-11-08T09:30',terms:'Terms',gifts:[]};
 const app=harness([{status:200,body:{...base(),diwaliGifts:offer}}]);
 await app.hooks.load();app.hooks.setTab('diwali-gifts');app.hooks.render();
 const html=app.elements['#tab-content'].innerHTML;
 assert.match(html,/name="drawDate" type="date" value="2026-11-08"/);
 assert.match(html,/name="drawTime" type="time" value="09:30"/);
 assert.match(html,/Selected date: 08\/11\/26/);
});
