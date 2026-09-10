// Run with Node and sharp available (NODE_PATH may point at an asset tooling runtime).
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
(async () => {
  const mark = await fs.readFile(path.join(root, 'lawoss/brand/lawoss-mark.svg'), 'utf8');
  const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect x="24" y="24" width="976" height="976" rx="216" fill="#0A0E14"/><svg x="172" y="148" width="680" height="728" viewBox="154 102 172 188">${inner}</svg></svg>`;
  const icons = path.join(root, 'apps/desktop/resources/icons');
  const pub = path.join(root, 'apps/app/public');
  await fs.writeFile(path.join(icons, 'icon-source.svg'), icon);
  await fs.writeFile(path.join(pub, 'legalwork-mark.svg'), mark);
  for (const [file, size] of [['icon.png',1024],['icon-dark.png',1024],['dev/icon.png',1024],['dev/128x128.png',128],['dev/128x128@2x.png',256],['dev/32x32.png',32]]) {
    await sharp(Buffer.from(icon)).resize(size,size).png().toFile(path.join(icons,file));
  }
  for (const [file,size] of [['favicon-16x16.png',16],['favicon-32x32.png',32],['apple-touch-icon.png',180]]) {
    await sharp(Buffer.from(icon)).resize(size,size).png().toFile(path.join(pub,file));
  }
  // ICO supports PNG payloads, so Windows variants share the same rasterizer.
  const sizes = [16,24,32,48,64,128,256];
  const payloads = await Promise.all(sizes.map(size => sharp(Buffer.from(icon)).resize(size,size).png().toBuffer()));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1,2); header.writeUInt16LE(sizes.length,4);
  let offset = header.length;
  payloads.forEach((png,i) => {
    const entry = 6+i*16;
    header[entry] = header[entry+1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1,entry+4); header.writeUInt16LE(32,entry+6);
    header.writeUInt32LE(png.length,entry+8); header.writeUInt32LE(offset,entry+12);
    offset += png.length;
  });
  await fs.writeFile(path.join(icons,'icon.ico'),Buffer.concat([header,...payloads]));
  if (process.platform === 'darwin') {
    const temp = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'lawoss-icons-'));
    const set = path.join(temp,'LAWOSS.iconset');
    await fs.mkdir(set);
    for (const size of [16,32,128,256,512]) for (const scale of [1,2]) {
      await sharp(Buffer.from(icon)).resize(size*scale,size*scale).png().toFile(path.join(set,`icon_${size}x${size}${scale===2?'@2x':''}.png`));
    }
    execFileSync('iconutil',['-c','icns',set,'-o',path.join(icons,'icon.icns')]);
    await fs.copyFile(path.join(icons,'icon.icns'),path.join(icons,'dev/icon-dev.icns'));
    await fs.rm(temp,{recursive:true});
  }
  console.log('Generated LAWOSS B desktop and web icons.');
})();
