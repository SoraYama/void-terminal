import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';

const require=createRequire(import.meta.url);
// Use the image encoder already declared by Next.js; no extra runtime service.
const sharp=createRequire(require.resolve('next/package.json'))('sharp');
const app=new URL('../apps/web/src/app/',import.meta.url);
const source=await readFile(new URL('icon.svg',app));
const sizes=[16,32,48];
const images=await Promise.all(sizes.map(size=>sharp(source,{density:384}).resize(size,size).png().toBuffer()));

// ICO supports embedded PNG images. Keep all three native tab/desktop sizes.
const header=Buffer.alloc(6+16*sizes.length);
header.writeUInt16LE(1,2);
header.writeUInt16LE(sizes.length,4);
let offset=header.length;
for(let i=0;i<sizes.length;i++){
  const entry=6+i*16;
  header[entry]=sizes[i];
  header[entry+1]=sizes[i];
  header.writeUInt16LE(1,entry+4);
  header.writeUInt16LE(32,entry+6);
  header.writeUInt32LE(images[i].length,entry+8);
  header.writeUInt32LE(offset,entry+12);
  offset+=images[i].length;
}
await writeFile(new URL('favicon.ico',app),Buffer.concat([header,...images]));
await sharp(source,{density:384}).resize(180,180).flatten({background:'#243d52'}).png().toFile(new URL('apple-icon.png',app).pathname);
console.log('Generated favicon.ico (16/32/48px) and apple-icon.png (180px) from icon.svg');
