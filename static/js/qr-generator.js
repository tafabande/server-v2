export class QRGenerator {
    static async generate(text, container) {
        if (!window.QRious) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
        }

        if (!text || !container) return;
        
        let canvas = container.querySelector("canvas");
        if (!canvas) {
            canvas = document.createElement("canvas");
            container.innerHTML = "";
            container.appendChild(canvas);
        }
        
        new window.QRious({
            element: canvas,
            value: text,
            size: 200,
            background: "#ffffff",
            foreground: "#000000",
            level: "M"
        });
    }
}