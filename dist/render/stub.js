// WP0 placeholder renderer: solid background + text lines. WP6 replaces usages with real cards.
import { createCanvas } from '@napi-rs/canvas';
export async function renderStub(title, lines = [], color = '#1e2a38') {
    const width = 640;
    const height = 80 + lines.length * 28;
    const canvas = createCanvas(width, height);
    const g = canvas.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, width, height);
    g.fillStyle = '#ffffff';
    g.font = 'bold 28px sans-serif';
    g.fillText(title, 20, 45);
    g.font = '20px sans-serif';
    lines.forEach((l, i) => g.fillText(l, 20, 80 + i * 28));
    return canvas.encode('png');
}
//# sourceMappingURL=stub.js.map