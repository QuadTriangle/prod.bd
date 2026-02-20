// Request buffer — queues incoming requests when the CLI tunnel is briefly disconnected.
// Drains automatically when the tunnel reconnects.

export class RequestBuffer {
    private queue: { request: Request; resolve: (resp: Response) => void }[] = [];
    private maxSize = 50;
    private timeoutMs = 10_000;

    enqueue(request: Request): Promise<Response> {
        if (this.queue.length >= this.maxSize) {
            return Promise.resolve(new Response("Buffer full", { status: 502 }));
        }
        return new Promise<Response>((resolve) => {
            const timer = setTimeout(() => {
                this.remove(request);
                resolve(new Response("Tunnel reconnect timeout", { status: 504 }));
            }, this.timeoutMs);

            this.queue.push({
                request,
                resolve: (resp) => { clearTimeout(timer); resolve(resp); },
            });
        });
    }

    private remove(request: Request) {
        this.queue = this.queue.filter((e) => e.request !== request);
    }

    drain(): { request: Request; resolve: (resp: Response) => void }[] {
        return this.queue.splice(0);
    }

    get size() { return this.queue.length; }
}
