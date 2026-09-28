import sharp from 'sharp';
const source=new URL('../assets/icon.svg',import.meta.url);
for(const size of [192,512])await sharp(source.pathname.replace(/^\/(.:)/,'$1')).resize(size,size).png().toFile(new URL(`../assets/icon-${size}.png`,import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
const foreground=await sharp(source.pathname.replace(/^\/(.:)/,'$1')).resize(300,300).png().toBuffer();
await sharp({create:{width:512,height:512,channels:4,background:'#214f46'}}).composite([{input:foreground,left:106,top:106}]).png().toFile(new URL('../assets/icon-maskable.png',import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
