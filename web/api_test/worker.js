self.onmessage = ({ data }) => self.postMessage({ ok: true, value: data * 2, userAgent: self.navigator?.userAgent ?? "worker" });
