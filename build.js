// build.js
// สคริปต์รันบนระบบ Vercel ตอน Deploy เพื่ออ่าน Environment Variables
// และนำมาแทรกลงในไฟล์ config.js โดยตรงแบบปลอดภัย
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, 'config.js');

if (fs.existsSync(configPath)) {
    console.log('Found config.js, injecting environment variables...');
    let content = fs.readFileSync(configPath, 'utf8');

    // ดึงค่าตัวแปรแวดล้อมจาก Vercel (หรือระบบบิวต์)
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseAnonKey) {
        console.warn('Warning: SUPABASE_URL or SUPABASE_ANON_KEY environment variables are missing.');
    }

    // แทนที่ค่าด้วย Regular Expressions
    content = content.replace(
        /supabaseUrl:\s*["'].*?["']/g,
        `supabaseUrl: "${supabaseUrl}"`
    ).replace(
        /supabaseAnonKey:\s*["'].*?["']/g,
        `supabaseAnonKey: "${supabaseAnonKey}"`
    );

    fs.writeFileSync(configPath, content, 'utf8');
    console.log('Successfully injected Supabase secrets into config.js');
} else {
    console.error('Error: config.js not found in current directory!');
    process.exit(1);
}
