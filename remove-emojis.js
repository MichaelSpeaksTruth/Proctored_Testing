const fs = require('fs');
const path = require('path');

// A regex that matches most emojis
const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}\u{2B50}\u{1F200}-\u{1F251}]/gu;

function walkDir(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walkDir(file));
        } else { 
            if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.css')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walkDir(path.join(__dirname, 'proctored-testing', 'src'));
let modified = 0;

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    if (emojiRegex.test(content)) {
        // Strip emojis
        content = content.replace(emojiRegex, '');
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Removed emojis from ${file}`);
        modified++;
    }
});

console.log(`Done. Modified ${modified} files.`);
