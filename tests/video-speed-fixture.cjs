// 组件和媒体行为为模拟；nativeMarkup 分支使用现场采集的原生菜单 DOM。
const fs=require('node:fs'),path=require('node:path');
function installSpeedPlayer(video, config={}) {
 const doc=video.ownerDocument,root=doc.createElement('div');root.className='video-js';root.id=config.id||'video';
 video.replaceWith(root);root.append(video);
 let holder,menuNode;
 if(config.nativeMarkup){
  const template=doc.createElement('template');template.innerHTML=fs.readFileSync(path.join(__dirname,'fixtures/video-speed-chaoxing-menu.html'),'utf8');
  holder=template.content.querySelector('.vjs-playback-rate.vjs-control');menuNode=holder.querySelector('.vjs-menu');
  holder.querySelector('button').setAttribute('aria-expanded','false');menuNode.classList.remove('vjs-lock-showing');
 }else{holder=doc.createElement('div');holder.className='vjs-playback-rate';menuNode=doc.createElement('ul');holder.append(menuNode);}
 root.append(holder);menuNode.style.display='none';
 const rates=config.rates===undefined?[0.75,1,1.25,1.5,2]:config.rates;
 let rate=1,nativeClick=false;const clicks=[];
 Object.defineProperty(video,'playbackRate',{configurable:true,get:()=>rate,set:value=>{if(!nativeClick)throw Error('禁止直接写 playbackRate');rate=value;}});
 const options={playbackRates:rates};let player;
 const entries=config.nativeMarkup?[...menuNode.querySelectorAll('li')].map(node=>({node,speed:Number.parseFloat(node.querySelector('.vjs-menu-item-text').textContent)})):(config.menuRates||rates||[]).map(speed=>{
  const node=doc.createElement('li');node.className='vjs-menu-item';node.setAttribute('role','menuitemradio');node.textContent=speed+'x';menuNode.append(node);return {node,speed};
 });
 const items=entries.map(({node,speed})=>{
  node.classList.toggle('vjs-selected',speed===1);node.setAttribute('aria-checked',String(speed===1));
  node.onclick=()=>{clicks.push(speed);if(config.reject)return;nativeClick=true;video.playbackRate=speed;nativeClick=false;video.dispatchEvent(new doc.defaultView.Event('ratechange'));};
  return {el:()=>node,options:()=>config.omitItemRate?{label:speed+'x'}:{rate:speed+'x'},player:()=>player};
 });
 const button={el:()=>holder,items,player:()=>player,playbackRateSupported:()=>config.supported!==false,
  menu:{show:()=>menuNode.style.display='block',hide:()=>menuNode.style.display='none'},
  addClass:name=>holder.classList.add(name),removeClass:name=>holder.classList.remove(name)};
 const bar={getChild:name=>name==='playbackRateMenuButton'?button:null};
 player={el:()=>root,options:()=>options,isReady_:true,isDisposed:()=>false,getChild:name=>name==='controlBar'?bar:null,playbackRates:()=>options.playbackRates};
 root.player=player;if(rates===false)holder.classList.add('vjs-hidden');
 return {root,player,button,items,options,clicks,holder,menuNode,reset:()=>{rate=1;}};
}
module.exports={installSpeedPlayer};
