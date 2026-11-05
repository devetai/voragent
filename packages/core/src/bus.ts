import { EventEmitter } from 'node:events';
import type { VEvent } from '@voragent/shared';

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(e: VEvent): void {
    this.emitter.emit('event', e);
  }

  /** Returns an unsubscribe function. */
  subscribe(fn: (e: VEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => {
      this.emitter.off('event', fn);
    };
  }
}
