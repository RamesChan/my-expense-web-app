// build.js
// สคริปต์รันบนระบบ Vercel ตอน Deploy เพื่อคัดลอกไฟล์ static
// ไปยังโฟลเดอร์ dist และทำการแทรก Environment Variables ลงในไฟล์ปลายทางอย่างปลอดภัย
const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, 'dist');

console.log('Starting build process...');

// 1. สร้างโฟลเดอร์ dist หากยังไม่มี
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
    console.log('Created dist directory');
}

// 2. รายชื่อไฟล์ static ที่จะถูกใช้ในการให้บริการบนเบราว์เซอร์
const filesToCopy = ['index.html', 'app.js', 'auth.js', 'db.js', 'config.js'];

// 3. คัดลอกและแทนที่ข้อมูลในไฟล์ปลายทาง
filesToCopy.forEach(file => {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(distDir, file);
    
    if (fs.existsSync(srcPath)) {
        let content = fs.readFileSync(srcPath, 'utf8');
        
        // ถ้าเป็น config.js ให้แทนที่ค่า API Keys ด้วย Environment Variables
        if (file === 'config.js') {
            console.log('Injecting environment variables into config.js...');
            const supabaseUrl = process.env.SUPABASE_URL || '';
            const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
            
            content = content.replace(
                /supabaseUrl:\s*["'].*?["']/g,
                `supabaseUrl: "${supabaseUrl}"`
            ).replace(
                /supabaseAnonKey:\s*["'].*?["']/g,
                `supabaseAnonKey: "${supabaseAnonKey}"`
            );
        }
        
        fs.writeFileSync(destPath, content, 'utf8');
        console.log(`Copied and processed: ${file} -> dist/${file}`);
    } else {
        console.error(`Error: Source file ${file} not found!`);
        process.exit(1);
    }
});

console.log('Build completed successfully. Static files are located in dist/');
