const text = "Hello world-class reader!";
let start = 10; // 'r' in world
while (start > 0 && /[\w\-]/.test(text[start - 1])) start--;
let end = 10;
while (end < text.length && /[\w\-]/.test(text[end])) end++;
console.log(text.slice(start, end));
