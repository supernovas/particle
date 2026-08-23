import type { MessagePosted, ParticleEvent } from '@particle/core';

export interface InboundMessage {
  projectKey: string;
  title: string;
  author: string;
  body: string;
  via: string;
  at: string;
}

export interface ChannelAdapter {
  readonly name: string;
  poll(): Promise<InboundMessage[]>;
  /** Mirror a project event outward. Must be idempotent per event id. */
  deliver(projectKey: string, event: ParticleEvent<MessagePosted>): Promise<void>;
}
