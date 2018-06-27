export enum PeerState {
  BANNED       = 0,
  DISCONNECTED = 1,
  CONNECTED    = 2,
}

// tslint:disable-next-line
export type PeerHeaders = {
  nethash: string;
  port: number;
  version: string;
  broadhash?: string;
  height?: number;
  nonce?: string;
  os?: string;
};

// tslint:disable-next-line
export interface BasePeerType {
  ip: string;
  port: number;
}

// tslint:disable-next-line
export interface PeerType extends BasePeerType {
  state: PeerState;
  os: string;
  version: string;
  broadhash: string;
  height: number;
  clock: number;
  updated: number;
  nonce: string;
}
// tslint:disable-next-line
export type PeerFilter = { limit?: number, offset?: number, orderBy?: string, ip?: string, port?: number, broadhash?: string, state?: PeerState };

export type BroadcastTaskOptions = {
  immediate?: boolean;
  data: any;
  api: string;
  method: string;
};
export type BroadcastTask = {
  options: BroadcastTaskOptions;
  params?: any
};


export type PeerRequestOptions = { api?: string, url?: string, method: 'GET' | 'POST', data?: any };