// Fail-closed visual gate for the *specific* 1280x720 Firefox Nightly native
// Quit confirmation. A fixed-delay click previously landed before the dialog
// existed and turned a valid cold-start measurement into a false close failure.
// No third-party image decoder: production CDP screenshots are 8-bit PNG.
import {inflateSync} from 'node:zlib';

const PNG_SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);

function paeth(a,b,c){
 const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
 return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

export function samplePngRgb(bytes,points){
 const png=Buffer.from(bytes);
 if(png.length<33||!png.subarray(0,8).equals(PNG_SIGNATURE))throw Error('Not a PNG screenshot');
 let width,height,channels,offset=8,seenHeader=false,seenEnd=false;
 const chunks=[];
 while(offset+12<=png.length){
  const length=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8);
  if(length>png.length-offset-12)throw Error('Truncated PNG chunk');
  const body=png.subarray(offset+8,offset+8+length);offset+=length+12;
  if(type==='IHDR'){
   if(seenHeader||length!==13)throw Error('Invalid PNG IHDR');
   seenHeader=true;width=body.readUInt32BE(0);height=body.readUInt32BE(4);
   const depth=body[8],color=body[9];
   if(!width||!height||width>8192||height>8192||depth!==8||![2,6].includes(color)||body[10]!==0||body[11]!==0||body[12]!==0)throw Error('Unsupported PNG screenshot format');
   channels=color===2?3:4;
  }else if(type==='IDAT')chunks.push(body);
  else if(type==='IEND'){seenEnd=true;break;}
 }
 if(!seenHeader||!seenEnd||!chunks.length)throw Error('Incomplete PNG screenshot');
 const rowLength=width*channels;
 const decoded=inflateSync(Buffer.concat(chunks),{maxOutputLength:(rowLength+1)*height});
 if(decoded.length!==(rowLength+1)*height)throw Error('Incorrect PNG scanline length');
 const requested=points.map(({x,y})=>{
  x=Math.round(x);y=Math.round(y);
  if(!Number.isSafeInteger(x)||!Number.isSafeInteger(y)||x<0||x>=width||y<0||y>=height)throw Error('Sample outside PNG screenshot');
  return {x,y};
 });
 const samples=new Array(points.length);let previous=Buffer.alloc(rowLength),current=Buffer.alloc(rowLength);
 const lastY=Math.max(-1,...requested.map(p=>p.y));
 for(let y=0;y<=lastY;y++){
  const start=y*(rowLength+1),filter=decoded[start];
  if(filter>4)throw Error('Unsupported PNG scanline filter');
  for(let i=0;i<rowLength;i++){
   const left=i>=channels?current[i-channels]:0,above=previous[i],upLeft=i>=channels?previous[i-channels]:0;
   const predictor=filter===0?0:filter===1?left:filter===2?above:filter===3?Math.floor((left+above)/2):paeth(left,above,upLeft);
   current[i]=(decoded[start+1+i]+predictor)&255;
  }
  for(let i=0;i<requested.length;i++)if(requested[i].y===y){const j=requested[i].x*channels;samples[i]=[current[j],current[j+1],current[j+2]];}
  [previous,current]=[current,previous];
 }
 return samples;
}

// Fixed guest coordinates match the separately observed Nightly dialog in
// the retained 2026-11-03 native-close.png. Other geometries fail closed.
export function nativeQuitDialogVisible(png,viewport,canvas){
 if(!viewport||!canvas||Math.abs(canvas.width/canvas.height-1280/720)>0.01)return false;
 try{
  const screenshot=Buffer.from(png),w=screenshot.readUInt32BE(16),h=screenshot.readUInt32BE(20);
  const ratioX=w/viewport.width,ratioY=h/viewport.height;
  if(!Number.isFinite(ratioX)||!Number.isFinite(ratioY)||ratioX<=0||ratioY<=0)return false;
  const pts=[[408,145],[548,155],[738,150],[413,240],[788,145],[695,225]];
  const pixels=samplePngRgb(screenshot,pts.map(([x,y])=>({x:(canvas.left+x*canvas.width/1280)*ratioX,y:(canvas.top+y*canvas.height/720)*ratioY})));
  const white=pixels.slice(0,4).every(([r,g,b])=>r>225&&g>225&&b>225&&Math.max(r,g,b)-Math.min(r,g,b)<32);
  const outside=pixels[4],button=pixels[5];
  const outsideLuma=(outside[0]+outside[1]+outside[2])/3;
  const buttonPurple=button[2]>button[0]+35&&button[2]>button[1]+55&&button[0]>button[1]+10;
  return white&&outsideLuma<145&&buttonPurple;
 }catch{return false;}
}
