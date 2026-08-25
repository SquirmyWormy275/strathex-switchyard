import type { JournalAuthenticator } from "../../../packages/control-plane/src/store.ts";
import {
  DpapiJournalAuthenticator,
  WindowsDpapiCurrentUserProtector,
  type UserSecretProtector
} from "./windows-secret.ts";

/** Compatibility export; all DPAPI work uses the bounded protector. */
export class WindowsDpapiJournalAuthenticator implements JournalAuthenticator {
  readonly provider = "windows-dpapi-current-user-v1";
  private readonly delegate: DpapiJournalAuthenticator;

  constructor(protector: UserSecretProtector = new WindowsDpapiCurrentUserProtector()) {
    this.delegate = new DpapiJournalAuthenticator(protector);
  }

  seal(hash: string): Promise<string> {
    return this.delegate.seal(hash);
  }

  verify(hash: string, tag: string): Promise<boolean> {
    return this.delegate.verify(hash, tag);
  }
}
