import { invoke } from './guest-content.sys.mjs';
export class NightlyJitSafetyChild extends JSWindowActorChild {
  receiveMessage(message) {
    if (message.name !== 'NightlyJitSafety:Invoke') throw Error('unrecognized owned gate message');
    const label = message.data.label;
    const call = (method, path, value) => this.sendQuery('NightlyJitSafety:IO', { label, method, path, value });
    const io = { read:path => call('read',path), exists:path => call('exists',path), writeUTF8:(path,value) => call('writeUTF8',path,value), writeJSON:(path,value) => call('writeJSON',path,value) };
    return invoke(this.contentWindow, message.data, io);
  }
}
