import fs from 'fs';
import path from 'path';

const EXCLUDE_DIRS = ['node_modules', 'dist', '.git', '.next'];
const EXCLUDE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.mp4', '.webm', '.zip', '.tar', '.gz'];

function walkSync(currentDirPath, callback) {
    fs.readdirSync(currentDirPath).forEach(function (name) {
        const filePath = path.join(currentDirPath, name);
        const stat = fs.statSync(filePath);
        if (stat.isFile()) {
            if (!EXCLUDE_EXTS.includes(path.extname(filePath).toLowerCase())) {
                callback(filePath, stat);
            }
        } else if (stat.isDirectory()) {
            if (!EXCLUDE_DIRS.includes(name)) {
                walkSync(filePath, callback);
            }
        }
    });
}

let output = '# Codebase Export\n\n';
walkSync('.', function(filePath) {
    if (filePath.includes('export.mjs') || filePath.includes('codebase.md') || filePath.includes('package-lock.json')) return;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        output += `\n\n## File: ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`;
    } catch (e) {}
});

fs.writeFileSync('codebase.md', output);
console.log('Exported to codebase.md');
