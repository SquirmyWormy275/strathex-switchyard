import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { packagedRawHidHelperPath } from "../src/main.ts";

test("packaged Raw-HID helper path is derived only from the installed main module location", () => {
  const mainPath = resolve("C:\\Program Files\\STRATHEX\\app\\dist\\apps\\windows-companion\\src\\main.js");
  assert.equal(
    packagedRawHidHelperPath(mainPath),
    resolve("C:\\Program Files\\STRATHEX\\app\\dist\\apps\\windows-companion\\raw-hid\\strathex-b122-hid-helper.exe")
  );
});
