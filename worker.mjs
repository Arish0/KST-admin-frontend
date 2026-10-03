// Same-origin API forwarding keeps the admin session on its own domain.
export default {
 async fetch(request,env){
  const url=new URL(request.url),admin=env.SITE_ROLE==='admin',path=url.pathname;
  if(path.startsWith('/api/')||path.startsWith('/images/')){
   const image=path.startsWith('/images/');
   const allowed=image?request.method==='GET':admin?(path==='/api/login'||path==='/api/admin'||path.startsWith('/api/admin/')):(path==='/api/catalog'||path==='/api/orders');
   if(!allowed)return Response.json({error:'Not found'},{status:404});
   if(request.method==='POST'){
    const origin=request.headers.get('Origin');
    if((origin&&origin!==url.origin)||request.headers.get('Sec-Fetch-Site')==='cross-site')return Response.json({error:'Invalid request origin'},{status:403});
   }
   const headers=new Headers(request.headers);headers.delete('x-kst-site-role');headers.delete('x-kst-client-ip');
   headers.set('x-kst-site-role',admin?'admin':'customer');headers.set('x-kst-client-ip',request.headers.get('CF-Connecting-IP')||'unknown');
   if(!admin)headers.delete('Cookie');
   if(!env.PROXY_SECRET)return Response.json({error:'The shop connection is not configured'},{status:503});
   headers.set('x-kst-proxy-token',env.PROXY_SECRET);
   if(env.BACKEND)return env.BACKEND.fetch(new Request(request,{headers}));
   let backend;try{backend=new URL(env.BACKEND_URL);}catch{return Response.json({error:'The shop connection is not configured'},{status:503});}
   if(backend.protocol!=='https:')return Response.json({error:'The shop connection is not configured'},{status:503});
   backend.pathname=path;backend.search=url.search;
   headers.delete('Host');
   return fetch(new Request(backend,new Request(request,{headers,redirect:'manual'})));
  }
  if(!admin&&(path==='/admin'||path.startsWith('/admin/')))return new Response('Not found',{status:404});
  const response=await env.ASSETS.fetch(request),headers=new Headers(response.headers);
  headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');headers.set('Referrer-Policy','no-referrer');headers.set('Permissions-Policy','geolocation=(self), camera=(), microphone=()');headers.set('Strict-Transport-Security','max-age=31536000');
  if(headers.get('Content-Type')?.includes('text/html')){
   const html=await response.text(),hashes=[];
   for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){if(match[1]){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(match[1]));hashes.push(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`);}}
   headers.set('Content-Security-Policy',`default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self' ${hashes.join(' ')}; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
   headers.set('Cache-Control','no-cache');headers.delete('Content-Length');headers.delete('ETag');
   return new Response(html,{status:response.status,headers});
  }
  return new Response(response.body,{status:response.status,headers});
 }
};
