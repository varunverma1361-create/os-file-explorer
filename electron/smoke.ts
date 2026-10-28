import type { BrowserWindow } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
export async function runSmoke(window: BrowserWindow) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "os-explorer-smoke-"));
  try {
    const result = await window.webContents.executeJavaScript(`(async()=>{
   const api=window.explorer; const root=${JSON.stringify(root)};
   const join=(name)=>root+${JSON.stringify(path.sep)}+name;
   const check=async(p)=>{const r=await p;if(!r.ok) throw new Error(r.error);return r.value;};
   for(let i=0;i<100 && !document.querySelector('[data-testid="file-list"]');i++) await new Promise(r=>setTimeout(r,100));
   if(!document.querySelector('[data-testid="file-list"]')) throw new Error('React interface did not render');
   if(typeof window.require!=='undefined') throw new Error('Node leaked to renderer');
   const address=document.querySelector('input[aria-label="Address"]');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(address,root);
   address.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,100));address.form.requestSubmit();
   for(let i=0;i<100 && !document.querySelector('.empty');i++) await new Promise(r=>setTimeout(r,100));
   if(!document.querySelector('.empty')) throw new Error('UI directory navigation failed');
   document.querySelector('button[aria-label="New"]').click();
   await new Promise(r=>setTimeout(r,50));
   [...document.querySelectorAll('.menu button')].find(b=>b.textContent==='New Folder').click();
   await new Promise(r=>setTimeout(r,50));
   const name=document.getElementById('item-name');
   Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'UI Created Folder');
   name.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,50));name.form.requestSubmit();
   for(let i=0;i<100 && ![...document.querySelectorAll('.file-row')].some(e=>e.textContent.includes('UI Created Folder'));i++) await new Promise(r=>setTimeout(r,100));
   if(![...document.querySelectorAll('.file-row')].some(e=>e.textContent.includes('UI Created Folder'))) throw new Error('UI create folder failed');
   await check(api.list(root,false));await check(api.watch(root));
   const changed=new Promise((resolve,reject)=>{const off=api.onChange(e=>{if(e.path===root){off();resolve(true);}});setTimeout(()=>{off();reject(new Error('Watcher timeout'));},12000);});
   await check(api.create(root,'hello.txt','text')); await changed;
   await check(api.rename(join('hello.txt'),'renamed.txt'));
   await check(api.create(root,'destination','folder'));
   await check(api.transfer(join('renamed.txt'),join('destination'),'copy'));
   await check(api.create(root,'move target','folder'));
   await check(api.transfer(join('renamed.txt'),join('move target'),'cut'));
   await check(api.preview(join('move target')+${JSON.stringify(path.sep)}+'renamed.txt'));
   await check(api.properties(join('destination')));
   const found=await check(api.search(root,'renamed',true,true,'smoke'));if(found.entries.length!==2) throw new Error('Search mismatch');
   await check(api.trash(join('move target')));
   const listed=await check(api.list(root,true));if(listed.entries.some(e=>e.name==='move target')) throw new Error('Trash failed');
   const invalid=await api.create(root,'CON','file');if(invalid.ok) throw new Error('Invalid name accepted');
   for(let i=0;i<150;i++) {
    const rows=[...document.querySelectorAll('.file-row')];
    if(rows.length===2 && rows.some(e=>e.textContent.includes('destination')) && !document.querySelector('.loading-line')) break;
    await new Promise(r=>setTimeout(r,100));
   }
   if(document.querySelectorAll('.file-row').length!==2 || ![...document.querySelectorAll('.file-row')].some(e=>e.textContent.includes('destination'))) throw new Error('Live UI listing did not settle after burst of filesystem changes');
   return {renderer:true,uiNavigation:true,uiCreateFolder:true,liveUIAfterBurst:true,securePreload:true,listing:true,watching:true,create:true,rename:true,copy:true,move:true,preview:true,properties:true,search:true,recycleBin:true,validation:true};
  })()`);
    console.log("SMOKE_RESULT " + JSON.stringify(result));
    if (!(await fs.stat(path.join(root, "UI Created Folder"))).isDirectory())
      throw new Error("UI creation did not reach the filesystem");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const screenshot = await window.webContents.capturePage();
    if (!app.isPackaged)
      await fs.writeFile(
        path.join(app.getAppPath(), "desktop-preview.png"),
        screenshot.toPNG(),
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
