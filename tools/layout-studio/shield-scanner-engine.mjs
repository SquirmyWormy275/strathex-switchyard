/** Pinned, dependency-free baseline scanner. Never executes scanned code or feed patterns. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, inflateRawSync, crc32 } from "node:zlib";

export const shieldEngineVersion = "switchyard-baseline-scanner/1";

// BEGIN GENERATED SPDX IDENTIFIERS
// SPDX license-list-data 3.29.0, commit 31ba1a50e5397e00a304dbadc76531740e89ee48.
// Identifier projection SHA-256: 3d34782ac9952b0cac692d00f6629b5edb8a82b2f0cd7992ba94bcba3263041c. See docs/npm-license-declarations.md.
export const spdxLicenseListVersion = "3.29.0";
const spdxLicenseIds = new Set("0bsd 3d-slicer-1.0 aal abstyles adacore-doc adobe-2006 adobe-display-postscript adobe-glyph adobe-utopia adsl advanced-cryptics-dictionary afl-1.1 afl-1.2 afl-2.0 afl-2.1 afl-3.0 afmparse agpl-1.0 agpl-1.0-only agpl-1.0-or-later agpl-3.0 agpl-3.0-only agpl-3.0-or-later aladdin alglib-documentation amd-newlib amdplpa aml aml-glslang ampas antlr-pd antlr-pd-fallback any-osi any-osi-perl-modules apache-1.0 apache-1.1 apache-2.0 apafml apl-1.0 app-s2p apsl-1.0 apsl-1.1 apsl-1.2 apsl-2.0 arphic-1999 artistic-1.0 artistic-1.0-cl8 artistic-1.0-perl artistic-2.0 artistic-dist aspell-ru aswf-digital-assets-1.0 aswf-digital-assets-1.1 atc-game baekmuk bahyph barr bcrypt-solar-designer beerware bitstream-charter bitstream-vera bittorrent-1.0 bittorrent-1.1 blessing blueoak-1.0.0 boehm-gc boehm-gc-without-fee bola-1.1 borceux brian-gladman-2-clause brian-gladman-3-clause brian-gladman-3-clause-no-conversion bsd-1-clause bsd-2-clause bsd-2-clause-darwin bsd-2-clause-first-lines bsd-2-clause-freebsd bsd-2-clause-netbsd bsd-2-clause-patent bsd-2-clause-pkgconf-disclaimer bsd-2-clause-pos-unchanged bsd-2-clause-views bsd-3-clause bsd-3-clause-acpica bsd-3-clause-attribution bsd-3-clause-clear bsd-3-clause-flex bsd-3-clause-hp bsd-3-clause-lbnl bsd-3-clause-modification bsd-3-clause-no-military-license bsd-3-clause-no-nuclear-license bsd-3-clause-no-nuclear-license-2014 bsd-3-clause-no-nuclear-warranty bsd-3-clause-open-mpi bsd-3-clause-openwebui bsd-3-clause-sun bsd-3-clause-tso bsd-4-clause bsd-4-clause-shortened bsd-4-clause-uc bsd-4.3reno bsd-4.3tahoe bsd-advertising-acknowledgement bsd-ask-to-endorse bsd-attribution-hpnd-disclaimer bsd-inferno-nettverk bsd-mark-modifications bsd-protection bsd-source-alt-gpl bsd-source-beginning-file bsd-source-code bsd-source-code-no-disclaimer bsd-systemics bsd-systemics-w3works bsl-1.0 buddy bugroff busl-1.1 bzip2-1.0.5 bzip2-1.0.6 c-uda-1.0 cal-1.0 cal-1.0-combined-work-exception caldera caldera-no-preamble capec-tou catharon catosl-1.1 cc-by-1.0 cc-by-2.0 cc-by-2.5 cc-by-2.5-au cc-by-3.0 cc-by-3.0-at cc-by-3.0-au cc-by-3.0-de cc-by-3.0-igo cc-by-3.0-nl cc-by-3.0-us cc-by-4.0 cc-by-nc-1.0 cc-by-nc-2.0 cc-by-nc-2.5 cc-by-nc-3.0 cc-by-nc-3.0-de cc-by-nc-3.0-igo cc-by-nc-4.0 cc-by-nc-nd-1.0 cc-by-nc-nd-2.0 cc-by-nc-nd-2.5 cc-by-nc-nd-3.0 cc-by-nc-nd-3.0-de cc-by-nc-nd-3.0-igo cc-by-nc-nd-4.0 cc-by-nc-sa-1.0 cc-by-nc-sa-2.0 cc-by-nc-sa-2.0-de cc-by-nc-sa-2.0-fr cc-by-nc-sa-2.0-uk cc-by-nc-sa-2.5 cc-by-nc-sa-3.0 cc-by-nc-sa-3.0-de cc-by-nc-sa-3.0-igo cc-by-nc-sa-4.0 cc-by-nd-1.0 cc-by-nd-2.0 cc-by-nd-2.5 cc-by-nd-3.0 cc-by-nd-3.0-de cc-by-nd-4.0 cc-by-sa-1.0 cc-by-sa-2.0 cc-by-sa-2.0-uk cc-by-sa-2.1-jp cc-by-sa-2.5 cc-by-sa-3.0 cc-by-sa-3.0-at cc-by-sa-3.0-de cc-by-sa-3.0-igo cc-by-sa-4.0 cc-pddc cc-pdm-1.0 cc-sa-1.0 cc0-1.0 cddl-1.0 cddl-1.1 cdl-1.0 cdla-permissive-1.0 cdla-permissive-2.0 cdla-sharing-1.0 cecill-1.0 cecill-1.1 cecill-2.0 cecill-2.1 cecill-b cecill-c cern-ohl-1.1 cern-ohl-1.2 cern-ohl-p-2.0 cern-ohl-s-2.0 cern-ohl-w-2.0 cfitsio check-cvs checkmk clartistic clips cmu-mach cmu-mach-nodoc cnri-jython cnri-python cnri-python-gpl-compatible coil-1.0 community-spec-1.0 condor-1.1 copyleft-next-0.3.0 copyleft-next-0.3.1 cornell-lossless-jpeg cpal-1.0 cpl-1.0 cpol-1.02 cronyx crossword cryptoswift crystalstacker cua-opl-1.0 cube curl cve-tou d-fsl-1.0 dec-3-clause diffmark dl-de-by-2.0 dl-de-zero-2.0 doc docbook-dtd docbook-schema docbook-stylesheet docbook-xml dotseqn drl-1.0 drl-1.1 dsdp dtoa dvipdfm ecl-1.0 ecl-2.0 ecos-2.0 efl-1.0 efl-2.0 egenix elastic-2.0 entessa epics epl-1.0 epl-2.0 erlpl-1.1 esa-pl-permissive-2.4 esa-pl-strong-copyleft-2.4 esa-pl-weak-copyleft-2.4 etalab-2.0 eudatagrid eupl-1.0 eupl-1.1 eupl-1.2 eurosym fair fbm fdk-aac fdk-mpeg-h ferguson-twofish frameworx-1.0 freebsd-doc freeimage fsfap fsfap-no-warranty-disclaimer fsful fsfullr fsfullrsd fsfullrwd fsl-1.1-alv2 fsl-1.1-mit ftl furuseth fwlw game-programming-gems gcr-docs gd generic-xts gfdl-1.1 gfdl-1.1-invariants-only gfdl-1.1-invariants-or-later gfdl-1.1-no-invariants-only gfdl-1.1-no-invariants-or-later gfdl-1.1-only gfdl-1.1-or-later gfdl-1.2 gfdl-1.2-invariants-only gfdl-1.2-invariants-or-later gfdl-1.2-no-invariants-only gfdl-1.2-no-invariants-or-later gfdl-1.2-only gfdl-1.2-or-later gfdl-1.3 gfdl-1.3-invariants-only gfdl-1.3-invariants-or-later gfdl-1.3-no-invariants-only gfdl-1.3-no-invariants-or-later gfdl-1.3-only gfdl-1.3-or-later giftware gl2ps glide glulxe glwtpl gnuplot gpl-1.0 gpl-1.0+ gpl-1.0-only gpl-1.0-or-later gpl-2.0 gpl-2.0+ gpl-2.0-only gpl-2.0-or-later gpl-2.0-with-autoconf-exception gpl-2.0-with-bison-exception gpl-2.0-with-classpath-exception gpl-2.0-with-font-exception gpl-2.0-with-gcc-exception gpl-3.0 gpl-3.0+ gpl-3.0-only gpl-3.0-or-later gpl-3.0-with-autoconf-exception gpl-3.0-with-gcc-exception graphics-gems gsoap-1.3b gtkbook gutmann haskellreport hdf5 hdparm hidapi hippocratic-2.1 hippocratic-3.0-core hp-1986 hp-1989 hpnd hpnd-dec hpnd-doc hpnd-doc-sell hpnd-export-us hpnd-export-us-acknowledgement hpnd-export-us-modify hpnd-export2-us hpnd-fenneberg-livingston hpnd-inria-imag hpnd-intel hpnd-kevlin-henney hpnd-markus-kuhn hpnd-merchantability-variant hpnd-mit-disclaimer hpnd-netrek hpnd-pbmplus hpnd-sell-mit-disclaimer-xserver hpnd-sell-regexpr hpnd-sell-variant hpnd-sell-variant-critical-systems hpnd-sell-variant-mit-disclaimer hpnd-sell-variant-mit-disclaimer-rev hpnd-smc hpnd-uc hpnd-uc-export-us htmltidy hyphen-bulgarian ibm-pibs icu iec-code-components-eula ijg ijg-short imagemagick imatix imlib2 info-zip informatica inner-net-2.0 innosetup intel intel-acpi interbase-1.0 ipa ipl-1.0 isc isc-veillard iso-permission jam jasper-2.0 jove jpl-image jpnic json kastrup kazlib knuth-ctan lal-1.2 lal-1.3 latex2e latex2e-translated-notice leptonica lgpl-2.0 lgpl-2.0+ lgpl-2.0-only lgpl-2.0-or-later lgpl-2.1 lgpl-2.1+ lgpl-2.1-only lgpl-2.1-or-later lgpl-3.0 lgpl-3.0+ lgpl-3.0-only lgpl-3.0-or-later lgpllr libpng libpng-1.6.35 libpng-2.0 libselinux-1.0 libtiff libutil-david-nugent liliq-p-1.1 liliq-r-1.1 liliq-rplus-1.1 linux-man-pages-1-para linux-man-pages-copyleft linux-man-pages-copyleft-2-para linux-man-pages-copyleft-var linux-openib loop lpd-document lpl-1.0 lpl-1.02 lppl-1.0 lppl-1.1 lppl-1.2 lppl-1.3a lppl-1.3c lsof lucida-bitmap-fonts lzma-sdk-9.11-to-9.20 lzma-sdk-9.22 mackerras-3-clause mackerras-3-clause-acknowledgment magaz mailprio makeindex man2html martin-birgmeier mcphee-slideshow metamail minpack mips miros mit mit-0 mit-advertising mit-click mit-cmu mit-enna mit-feh mit-festival mit-khronos-old mit-modern-variant mit-open-group mit-stk mit-testregex mit-wu mitnfa mmixware mmpl-1.0.1 motosoto mpeg-ssg mpi-permissive mpich2 mpl-1.0 mpl-1.1 mpl-2.0 mpl-2.0-no-copyleft-exception mplus ms-lpl ms-pl ms-rl mtll mulanpsl-1.0 mulanpsl-2.0 multics mup mvt-1.1 naist-2003 nasa-1.3 naumen nbpl-1.0 ncbi-pd ncgl-uk-2.0 ncl ncsa net-snmp netcdf newsletr ngpl ngrep nicta-1.0 nist-pd nist-pd-fallback nist-pd-tnt nist-software nlod-1.0 nlod-2.0 nlpl nokia nosl noweb npl-1.0 npl-1.1 nposl-3.0 nrl ntia-pd ntp ntp-0 nunit o-uda-1.0 oar occt-pl oclc-2.0 odbl-1.0 odc-by-1.0 offis ofl-1.0 ofl-1.0-no-rfn ofl-1.0-rfn ofl-1.1 ofl-1.1-no-rfn ofl-1.1-rfn ogc-1.0 ogdl-taiwan-1.0 ogl-canada-2.0 ogl-uk-1.0 ogl-uk-2.0 ogl-uk-3.0 ogtsl oldap-1.1 oldap-1.2 oldap-1.3 oldap-1.4 oldap-2.0 oldap-2.0.1 oldap-2.1 oldap-2.2 oldap-2.2.1 oldap-2.2.2 oldap-2.3 oldap-2.4 oldap-2.5 oldap-2.6 oldap-2.7 oldap-2.8 olfl-1.3 oml openmdw-1.0 openpbs-2.3 openssl openssl-standalone openvision opl-1.0 opl-uk-3.0 opubl-1.0 osc-1.0 oset-pl-2.1 osl-1.0 osl-1.1 osl-2.0 osl-2.1 osl-3.0 ossp padl paratype-free-font-1.3 parity-6.0.0 parity-7.0.0 pddl-1.0 php-3.0 php-3.01 pixar pkgconf plexus pnmstitch polyform-noncommercial-1.0.0 polyform-small-business-1.0.0 postgresql ppl psf-2.0 psfrag psutils python-2.0 python-2.0.1 python-ldap qhull qpl-1.0 qpl-1.0-inria-2004 radvd rdisc rhecos-1.1 rpl-1.1 rpl-1.5 rpsl-1.0 rsa-md rscpl ruby ruby-pty sax-pd sax-pd-2.0 saxpath scea schemereport sendmail sendmail-8.23 sendmail-open-source-1.1 sgi-b-1.0 sgi-b-1.1 sgi-b-2.0 sgi-opengl sgmlug-pm sgp4 shl-0.5 shl-0.51 simpl-2.0 sissl sissl-1.2 sl sleepycat smail-gpl smlnj smppl snia snprintf sofa softsurfer soundex spencer-86 spencer-94 spencer-99 spl-1.0 ssh-keyscan ssh-openssh ssh-short ssleay-standalone sspl-1.0 standardml-nj sugarcrm-1.1.3 sul-1.0 sun-ppp sun-ppp-2000 sunpro swl swrule symlinks tapr-ohl-1.0 tcl tcp-wrappers tekhvc termreadkey tgppl-1.0 thirdeye threeparttable tmate torque-1.1 tosl tpdl tpl-1.0 trustedqsl ttwl ttyp0 tu-berlin-1.0 tu-berlin-2.0 ubuntu-font-1.0 ucar ucl-1.0 ulem umich-merit unicode-3.0 unicode-dfs-2015 unicode-dfs-2016 unicode-tou unixcrypt unlicense unlicense-libtelnet unlicense-libwhirlpool unrar upl-1.0 urt-rle vim vixie-cron vostrom vsl-1.0 w3c w3c-19980720 w3c-20150513 w3m watcom-1.0 widget-workshop wordnet wsuipa wtfnmfpl wtfpl wwl wxwindows x11 x11-distribute-modifications-variant x11-no-permit-persons x11-swapped xdebug-1.03 xerox xfig xfree86-1.1 xinetd xkeyboard-config-zinoviev xlock xnet xpp xskat xzoom ypl-1.0 ypl-1.1 zed zeeff zend-2.0 zimbra-1.3 zimbra-1.4 zlib zlib-acknowledgement zpl-1.1 zpl-2.0 zpl-2.1".split(" "));
const spdxLicenseDeprecated = new Set("agpl-1.0 agpl-3.0 bsd-2-clause-freebsd bsd-2-clause-netbsd bzip2-1.0.5 ecos-2.0 gfdl-1.1 gfdl-1.2 gfdl-1.3 gpl-1.0 gpl-1.0+ gpl-2.0 gpl-2.0+ gpl-2.0-with-autoconf-exception gpl-2.0-with-bison-exception gpl-2.0-with-classpath-exception gpl-2.0-with-font-exception gpl-2.0-with-gcc-exception gpl-3.0 gpl-3.0+ gpl-3.0-with-autoconf-exception gpl-3.0-with-gcc-exception lgpl-2.0 lgpl-2.0+ lgpl-2.1 lgpl-2.1+ lgpl-3.0 lgpl-3.0+ net-snmp nunit standardml-nj wxwindows".split(" "));
const spdxExceptionIds = new Set("389-exception asterisk-exception asterisk-linking-protocols-exception autoconf-exception-2.0 autoconf-exception-3.0 autoconf-exception-generic autoconf-exception-generic-3.0 autoconf-exception-macro bison-exception-1.24 bison-exception-2.2 bootloader-exception cgal-linking-exception classpath-exception-2.0 classpath-exception-2.0-short clisp-exception-2.0 cryptsetup-openssl-exception digia-qt-lgpl-exception-1.1 digirule-foss-exception ecos-exception-2.0 erlang-otp-linking-exception fawkes-runtime-exception fltk-exception fmt-exception font-exception-2.0 freertos-exception-2.0 gcc-exception-2.0 gcc-exception-2.0-note gcc-exception-3.1 gmsh-exception gnat-exception gnome-examples-exception gnu-compiler-exception gnu-javamail-exception google-patent-webm gpl-3.0-389-ds-base-exception gpl-3.0-interface-exception gpl-3.0-linking-exception gpl-3.0-linking-source-exception gpl-cc-1.0 gstreamer-exception-2005 gstreamer-exception-2008 harbour-exception i2p-gpl-java-exception independent-modules-exception kicad-libraries-exception kvirc-openssl-exception lgpl-3.0-linking-exception libpri-openh323-exception libtool-exception linux-syscall-note llgpl llvm-exception lzma-exception mif-exception mxml-exception nokia-qt-exception-1.1 ocaml-lgpl-linking-exception occt-exception-1.0 openjdk-assembly-exception-1.0 openvpn-openssl-exception pcre2-exception polyparse-exception ps-or-pdf-font-exception-20170817 qpl-1.0-inria-2004-exception qt-gpl-exception-1.0 qt-lgpl-exception-1.1 qwt-exception-1.0 romic-exception rrdtool-floss-exception-2.0 rsync-linking-exception sane-exception shl-2.0 shl-2.1 simple-library-usage-exception spelling-provider-lgpl-exception sqlitestudio-openssl-exception stunnel-exception swi-exception swift-exception texinfo-exception u-boot-exception-2.0 ubdl-exception universal-foss-exception-1.0 vsftpd-openssl-exception wxwindows-exception-3.1 x11vnc-openssl-exception".split(" "));
const spdxExceptionDeprecated = new Set("nokia-qt-exception-1.1".split(" "));
// END GENERATED SPDX IDENTIFIERS

/** Catalog membership only: declarations do not prove license text or permission. */
export function spdxLicenseMembership(value) {
  const declaration = npmLicenseDeclaration(value);
  if (!declaration) return null;
  const tokens = declaration.expression.match(/[A-Za-z0-9][A-Za-z0-9.-]*\+?|[()]/g);
  let listed = true, deprecated = false;
  for (let i = 0; i < tokens.length; i++) {
    if (["AND", "OR", "WITH", "(", ")"].includes(tokens[i])) continue;
    const exception = tokens[i - 1] === "WITH", literal = tokens[i].toLowerCase();
    const id = exception ? literal : literal.replace(/\+$/, "");
    listed = (exception ? spdxExceptionIds : spdxLicenseIds).has(id) && listed;
    const old = exception ? spdxExceptionDeprecated : spdxLicenseDeprecated;
    deprecated = old.has(literal) || old.has(id) || deprecated;
  }
  return { version: spdxLicenseListVersion, listed, deprecated };
}

function licenseCatalogProperties(license) {
  const membership = spdxLicenseMembership(license);
  return membership ? [
    { name: "switchyard:spdx-list-version", value: membership.version },
    { name: "switchyard:spdx-identifiers-listed", value: String(membership.listed) },
    { name: "switchyard:spdx-identifiers-deprecated", value: String(membership.deprecated) }
  ] : [];
}

/** Bounded AND/OR/WITH declaration syntax, not license-list or legal verification. */
export function npmLicenseDeclaration(value, allowedLicenses = []) {
  if (typeof value !== "string" || !value || value.length > 512 || /[^A-Za-z0-9.()+ \t-]/.test(value)) return null;
  const tokens = []; let offset = 0;
  while (offset < value.length) {
    if (/[ \t]/.test(value[offset])) { offset++; continue; }
    const match = /^(?:[A-Za-z0-9][A-Za-z0-9.-]{0,79}\+?|[()])/.exec(value.slice(offset));
    if (!match || tokens.length >= 128) return null;
    if (["AND", "OR"].includes(match[0]) && (offset > 0 && !/[ \t()]/.test(value[offset - 1]) || offset + match[0].length < value.length && !/[ \t()]/.test(value[offset + match[0].length]))) return null;
    if (match[0] === "WITH" && (offset === 0 || !/[ \t]/.test(value[offset - 1]) || !/[ \t]/.test(value[offset + match[0].length] ?? ""))) return null;
    tokens.push(match[0]); offset += match[0].length;
  }
  let cursor = 0, atoms = 0, choice = false;
  const atom = depth => {
    if (depth > 16) throw Error("License expression nesting exceeds its bound.");
    const token = tokens[cursor++];
    if (token === "(") { const result = disjunction(depth + 1); if (tokens[cursor++] !== ")") throw Error("Unclosed license expression."); return result; }
    if (!token || ["AND", "OR", "WITH", "(", ")", "NONE", "NOASSERTION"].includes(token) || /^(?:LicenseRef-|DocumentRef-)/i.test(token) || ++atoms > 64) throw Error("Unsupported license declaration.");
    if (tokens[cursor] === "WITH") {
      cursor++; const exception = tokens[cursor++];
      if (!exception || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/.test(exception)
          || ["AND", "OR", "WITH", "NONE", "NOASSERTION"].includes(exception)
          || /^(?:LicenseRef-|DocumentRef-)/i.test(exception) || ++atoms > 64) throw Error("Unsupported license exception declaration.");
      return { atom: `${token} WITH ${exception}` };
    }
    return { atom: token };
  };
  const conjunction = depth => { let result = atom(depth); while (tokens[cursor] === "AND") { cursor++; result = { op: "AND", left: result, right: atom(depth) }; } return result; };
  const disjunction = depth => { let result = conjunction(depth); while (tokens[cursor] === "OR") { cursor++; choice = true; result = { op: "OR", left: result, right: conjunction(depth) }; } return result; };
  try {
    const tree = disjunction(0); if (cursor !== tokens.length) return null;
    const render = (node, parent = 0) => {
      if (node.atom) return node.atom;
      const precedence = node.op === "AND" ? 2 : 1;
      const text = `${render(node.left, precedence)} ${node.op} ${render(node.right, precedence)}`;
      return precedence < parent ? `(${text})` : text;
    };
    const expression = render(tree); if (expression.length > 512) return null;
    const allowed = new Set(allowedLicenses.map(id => id.toLowerCase()));
    const evaluate = node => node.atom ? allowed.has(node.atom.toLowerCase()) : node.op === "AND" ? evaluate(node.left) && evaluate(node.right) : evaluate(node.left) || evaluate(node.right);
    return { expression, allowed: evaluate(tree), choice };
  } catch { return null; }
}
export const shieldIndexPrefix = ".switchyard-index/";
export const shieldHistoryPrefix = ".switchyard-history/";
export const shieldReservedPath = path => [shieldIndexPrefix,shieldHistoryPrefix].some(prefix=>path===prefix.slice(0,-1)||path?.startsWith(prefix));
export const shieldActions = Object.freeze(["shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield"]);
const dimensions = {
  shield_change_scan: ["secrets", "pii", "security_defects"],
  shield_codebase_audit: ["secrets", "history", "insecure_paths", "permissions", "infrastructure"],
  shield_supply_chain: ["vulnerabilities", "licenses", "provenance", "sbom"],
  release_shield: ["secrets", "pii", "security_defects", "history", "insecure_paths", "permissions", "infrastructure", "vulnerabilities", "licenses", "provenance", "sbom", "isolation"]
};
// Patterns are code-owned, bounded and intentionally heuristic. Feeds choose fixed
// rule identifiers; they cannot supply a regex, executable, argument or URL to fetch.
const rules = Object.freeze({
  "secret.private-key": { dimension: "secrets", severity: "critical", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g },
  "secret.github-token": { dimension: "secrets", severity: "high", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{20,255})\b/g },
  "secret.aws-access-key": { dimension: "secrets", severity: "high", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  "pii.email": { dimension: "pii", severity: "medium", pattern: /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,128}\.[A-Za-z]{2,24}\b/g },
  "javascript.dynamic-code": { dimension: "security_defects", severity: "high", extensions: ["js", "mjs", "cjs", "ts", "tsx", "jsx"], pattern: /\b(?:eval\s*\(|new\s+Function\s*\()/g },
  "config.tls-verification-disabled": { dimension: "infrastructure", severity: "high", pattern: /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']?0)/g },
  "docker.privileged": { dimension: "infrastructure", severity: "high", extensions: ["yaml", "yml", "json"], pattern: /["']?privileged["']?\s*:\s*true/g },
  "path.request-traversal": { dimension: "insecure_paths", severity: "high", extensions: ["js", "mjs", "cjs", "ts", "tsx", "jsx"], pattern: /\b(?:join|resolve)\s*\([^\n;]{0,256}\b(?:req|request)\.(?:query|params|body)\b/g }
});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
function exact(v, keys) { if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw Error("Invalid closed scanner document."); }
function identifier(v) { if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) throw Error("Invalid scanner identifier."); return v; }
function digest(v) { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) throw Error("Invalid scanner digest."); return v; }
export function scannerPath(v) { if (typeof v !== "string" || v.length > 512 || v.includes("\\") || v.split("/").some(s => !s || s === "." || s === ".." || /[\x00-\x1f\x7f:]/.test(s)) || isAbsolute(v)) throw Error("Invalid relative scanner input."); return v; }
function array(v, limit) { if (!Array.isArray(v) || v.length > limit) throw Error("Scanner array exceeds its bound."); return v; }
function utf8(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
function json(bytes) { if (bytes.length > 2 * 1024 * 1024) throw Error("Scanner JSON exceeds its bound."); return JSON.parse(utf8(bytes)); }
// Cargo lock parsing stays inside the one digest-pinned, dependency-free worker.
const cargoRequire = value => { if (!value) throw Error('Unsupported bounded Cargo lock metadata.'); };
const cargoDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const cargoPublicSource = 'registry+https://github.com/rust-lang/crates.io-index';
export const cargoPublicSourceSha256 = sha(cargoPublicSource);
export const isCargoLockPath = path => typeof path === 'string' && path.length <= 512 && path.split('/').at(-1) === 'Cargo.lock' && path.split('/').every(part => part && !['.','..'].includes(part) && !/[\\\x00-\x1f\x7f:]/.test(part));
export function parseCargoVersion(version) {
  cargoRequire(typeof version === 'string' && version.length <= 256 && /^[0-9A-Za-z.+-]+$/.test(version));
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
  cargoRequire(match);
  const core = match.slice(1, 4), pre = match[4]?.split('.') ?? [], build = match[5]?.split('.') ?? [];
  cargoRequire(core.every(part => BigInt(part) <= 18446744073709551615n));
  cargoRequire(pre.every(part => !/^[0-9]+$/.test(part) || part === '0' || part[0] !== '0'));
  return { core, pre, build };
}
/** SemVer precedence ignores build metadata; inventory identity retains it. */
export function compareCargoVersions(left, right) {
  const a = parseCargoVersion(left), b = parseCargoVersion(right);
  const numeric = (x, y) => x.length !== y.length ? (x.length < y.length ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0;
  for (let i = 0; i < 3; i++) { const order = numeric(a.core[i], b.core[i]); if (order) return order; }
  if (!a.pre.length || !b.pre.length) return !a.pre.length && !b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i], xn = /^[0-9]+$/.test(x), yn = /^[0-9]+$/.test(y);
    const order = xn && yn ? numeric(x, y) : xn !== yn ? (xn ? -1 : 1) : x < y ? -1 : x > y ? 1 : 0;
    if (order) return order;
  }
  return a.pre.length < b.pre.length ? -1 : a.pre.length > b.pre.length ? 1 : 0;
}
export function cargoIdentity(name, version) {
  cargoRequire(typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name));
  parseCargoVersion(version);
  return { name, version };
}
export function cratesIoIdentity(name,version) {
  cargoIdentity(name,version);cargoRequire(/^[a-z][a-z0-9_-]{0,63}$/.test(name));return{ecosystem:'crates.io',name,version};
}
// This accepts the basic strings emitted by Cargo, not arbitrary TOML. In
// particular, JSON-only escapes, multiline strings and extra tables refuse.
const cargoQuoted = /^"(?:[^"\\\x00-\x1f]|\\(?:["\\bfnrt]|u(?![dD][89a-fA-F])[0-9a-fA-F]{4}))*"/;
function cargoUncomment(line) {
  let result = '', rest = line;
  while (rest) {
    if (rest[0] === '#') break;
    if (rest[0] === '"') { const match=cargoQuoted.exec(rest);cargoRequire(match);result+=match[0];rest=rest.slice(match[0].length); }
    else { cargoRequire(/^[\t\x20-\x7e]$/.test(rest[0]));result+=rest[0];rest=rest.slice(1); }
  }
  return result.trim();
}
function cargoString(value) {
  cargoRequire(cargoQuoted.exec(value)?.[0] === value);const parsed=JSON.parse(value);
  cargoRequire(parsed.length > 0 && parsed.length <= 2048 && parsed.isWellFormed() && !/[\x00-\x1f\x7f]/.test(parsed));return parsed;
}
function cargoDependencyList(value) {
  cargoRequire(value[0] === '[' && value.at(-1) === ']');let rest=value.slice(1,-1).trim();const rows=[];
  while(rest) { const match=cargoQuoted.exec(rest);cargoRequire(match);const item=cargoString(match[0]);cargoRequire(rows.length<4096);rows.push(item);rest=rest.slice(match[0].length).trim();if(!rest)break;cargoRequire(rest[0]===',');rest=rest.slice(1).trim(); }
  cargoRequire(new Set(rows).size===rows.length);return rows;
}
export function parseCargoLock(text) {
  cargoRequire(typeof text==='string' && text.isWellFormed() && Buffer.byteLength(text)<=1024*1024 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text) && !/\r(?!\n)/.test(text));
  const lines=text.replaceAll('\r\n','\n').split('\n');cargoRequire(lines.length<=32768 && lines.every(line=>line.length<=8192));
  const packages=[];let version, row, list;
  for(const raw of lines) {
    const line=cargoUncomment(raw);if(!line)continue;
    if(list!==undefined) { cargoRequire(list.length+line.length<=256*1024);list+=' '+line;if(line.endsWith(']')){row.dependencies=cargoDependencyList(list);list=undefined;}continue; }
    if(line==='[[package]]'){cargoRequire(version!==undefined && packages.length<4096);row={};packages.push(row);continue;}
    const match=/^([a-z][a-z0-9_-]*)\s*=\s*(.*)$/.exec(line);cargoRequire(match);const [,key,value]=match;
    if(!row){cargoRequire(version===undefined && key==='version' && ['3','4'].includes(value));version=Number(value);continue;}
    cargoRequire(['name','version','source','checksum','dependencies'].includes(key) && !Object.hasOwn(row,key));
    if(key==='dependencies') { if(value==='['){list=value;row.dependencies=null;}else row.dependencies=cargoDependencyList(value); }
    else row[key]=cargoString(value);
  }
  cargoRequire(version!==undefined && list===undefined);const identities=new Set();
  return packages.map(p=>{
    cargoIdentity(p.name,p.version);
    const source=p.source??null, sourceKind=source===null?'local':source===cargoPublicSource?'crates.io':source.startsWith('registry+')?'registry':source.startsWith('git+')?'git':null;
    cargoRequire(sourceKind && (source===null || /^[\x21-\x7e]{1,2048}$/.test(source) && !['git+','registry+'].includes(source)));
    if(sourceKind==='crates.io')cratesIoIdentity(p.name,p.version);
    cargoRequire(['registry','crates.io'].includes(sourceKind)?cargoDigest(p.checksum):p.checksum===undefined);
    const sourceSha256=source===null?null:sha(source), key=JSON.stringify([p.name,p.version,sourceSha256]);cargoRequire(!identities.has(key));identities.add(key);
    return {ecosystem:'Cargo',name:p.name,version:p.version,sourceKind,sourceSha256,declaredSha256:p.checksum??null,dependenciesSha256:sha(JSON.stringify(p.dependencies??[]))};
  });
}
export function validateCargoComponent(c) {
  cargoRequire(c && typeof c==='object' && !Array.isArray(c) && Object.keys(c).sort().join()===["declaredSha256","dependenciesSha256","ecosystem","lockPath","name","sourceKind","sourceSha256","version",...(Object.hasOwn(c,"artifact")?["artifact"]:[])].sort().join());
  cargoRequire(c.ecosystem==='Cargo' && isCargoLockPath(c.lockPath));cargoIdentity(c.name,c.version);cargoRequire(cargoDigest(c.dependenciesSha256));
  cargoRequire(['local','git','registry','crates.io'].includes(c.sourceKind));
  cargoRequire(c.sourceKind==='local'?c.sourceSha256===null:cargoDigest(c.sourceSha256));
  cargoRequire(['registry','crates.io'].includes(c.sourceKind)?cargoDigest(c.declaredSha256):c.declaredSha256===null);
  if(c.sourceKind==='crates.io'){cratesIoIdentity(c.name,c.version);cargoRequire(c.sourceSha256===cargoPublicSourceSha256);}else cargoRequire(c.sourceSha256!==cargoPublicSourceSha256);
  if (Object.hasOwn(c, "artifact")) {
    const a = c.artifact; exact(a, ["path", "sha256", "size", "algorithm", "expectedSha256", "status", "archive", "licensePolicy"]);
    scannerPath(a.path);
    cargoRequire(["registry", "crates.io"].includes(c.sourceKind) && cargoDigest(a.sha256) && Number.isSafeInteger(a.size) && a.size > 0 && a.size <= 2 * 1024 * 1024
      && a.algorithm === "sha256" && a.expectedSha256 === c.declaredSha256 && a.status === (a.sha256 === a.expectedSha256 ? "matched" : "mismatched"));
    validateCargoArchiveObservation(a.archive, c.name, c.version);
    const assessable = a.status === "matched" && a.archive.status === "matched" && a.archive.license.status === "declared";
    cargoRequire(assessable ? ["unconfigured", "permitted", "disallowed"].includes(a.licensePolicy) : a.licensePolicy === "unassessed");
  }
  return c;
}
export function cargoCycloneDxComponent(c) {
  validateCargoComponent(c);
  return {type:'library','bom-ref':'switchyard:'+sha(JSON.stringify(['Cargo',c.lockPath,c.name,c.version,c.sourceSha256])),name:c.name,version:c.version,
    ...(c.sourceKind==='crates.io'?{purl:`pkg:cargo/${c.name}@${encodeURIComponent(c.version)}`} : {}),properties:[
      {name:'switchyard:ecosystem',value:'Cargo'},{name:'switchyard:lockfile',value:c.lockPath},{name:'switchyard:cargo-source-kind',value:c.sourceKind},
      ...(c.sourceSha256?[{name:'switchyard:declared-source-sha256',value:c.sourceSha256}]:[]),...(c.declaredSha256?[{name:'switchyard:declared-sha256',value:c.declaredSha256}]:[]),
      {name:'switchyard:declared-dependencies-sha256',value:c.dependenciesSha256},{name:'switchyard:cargo-resolution',value:'not-performed'},
      ...(c.artifact ? [{name:'switchyard:artifact-path',value:c.artifact.path},{name:'switchyard:artifact-sha256',value:c.artifact.sha256},{name:'switchyard:artifact-integrity',value:c.artifact.status},{name:'switchyard:artifact-content',value:'not-inspected'},{name:'switchyard:archive-license-policy',value:c.artifact.licensePolicy},...archiveProperties(c.artifact.archive),...archiveLicenseProperties(c.artifact.archive.license)] : [])
    ]};
}

const npmName = value => typeof value === "string" && ![".", ".."].includes(value) && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]{1,128}$/.test(value);
/** Strict literal SemVer; numeric identifiers stay within npm's precise integer range. */
export function parseNpmVersion(value) {
  try {
    const parsed = parseCargoVersion(value);
    if ([...parsed.core, ...parsed.pre.filter(part => /^[0-9]+$/.test(part))].some(part => BigInt(part) > 9007199254740991n)) throw Error();
    return parsed;
  } catch { throw Error("Choose a literal npm SemVer of at most 256 characters with precise numeric identifiers."); }
}
export function compareNpmVersions(left, right) {
  parseNpmVersion(left); parseNpmVersion(right); return compareCargoVersions(left, right);
}
export function npmVersion(value) { try { parseNpmVersion(value); return true; } catch { return false; } }
// Bounded PEP 440 identifiers. Keep literal declarations in the BOM; compare
// identities by normalized numeric and suffix semantics, never lexicographic order.
const pythonVersionPattern = /^v?(?:([0-9]+)!)?([0-9]+(?:\.[0-9]+)*)(?:[-_.]?(alpha|beta|preview|pre|rc|a|b|c)[-_.]?([0-9]+)?)?(?:(?:-([0-9]+))|(?:[-_.]?(post|rev|r)[-_.]?([0-9]+)?))?(?:[-_.]?(dev)[-_.]?([0-9]+)?)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/i;
const pythonInteger = value => value.replace(/^0+(?=[0-9])/, "");
const comparePythonInteger = (a, b) => a.length === b.length ? (a < b ? -1 : a > b ? 1 : 0) : a.length < b.length ? -1 : 1;
export function parsePypiVersion(value) {
  if (typeof value !== "string" || !value.length || value.length > 128 || !/^[A-Za-z0-9.!+_-]+$/.test(value)) throw Error("Choose a bounded literal Python version without whitespace or controls.");
  const m = pythonVersionPattern.exec(value);
  if (!m) throw Error("Unsupported PEP 440 Python version.");
  const release = m[2].split(".").map(pythonInteger), local = m[10]?.toLowerCase().split(/[-_.]/).map(part => /^[0-9]+$/.test(part) ? [1, pythonInteger(part)] : [0, part]) ?? null;
  if (release.length > 32 || local && local.length > 32) throw Error("Python version segment bound exceeded.");
  const label = m[3]?.toLowerCase(), phase = label ? ({ alpha: 0, a: 0, beta: 1, b: 1, preview: 2, pre: 2, rc: 2, c: 2 })[label] : null;
  const dev = m[8] === undefined ? null : pythonInteger(m[9] ?? "0");
  return { epoch: pythonInteger(m[1] ?? "0"), release, pre: phase === null ? null : [phase, pythonInteger(m[4] ?? "0")], post: m[5] !== undefined || m[6] !== undefined ? pythonInteger(m[5] ?? m[7] ?? "0") : null, dev, local };
}
export function pypiVersionKey(value) {
  const v = parsePypiVersion(value), release = [...v.release];
  while (release.length > 1 && release.at(-1) === "0") release.pop();
  return JSON.stringify([v.epoch, release, v.pre, v.post, v.dev, v.local]);
}
export function comparePypiVersions(left, right) {
  const a = parsePypiVersion(left), b = parsePypiVersion(right), epoch = comparePythonInteger(a.epoch, b.epoch);
  if (epoch) return epoch;
  for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
    const order = comparePythonInteger(a.release[i] ?? "0", b.release[i] ?? "0"); if (order) return order;
  }
  const preRank = v => v.pre ? v.pre[0] : v.post === null && v.dev !== null ? -1 : 3;
  const rank = preRank(a) - preRank(b); if (rank) return Math.sign(rank);
  if (a.pre && b.pre) { const order = comparePythonInteger(a.pre[1], b.pre[1]); if (order) return order; }
  for (const [field, missingFirst] of [["post", true], ["dev", false]]) {
    if (a[field] === null || b[field] === null) { if (a[field] !== b[field]) return (a[field] === null) === missingFirst ? -1 : 1; }
    else { const order = comparePythonInteger(a[field], b[field]); if (order) return order; }
  }
  if (a.local === null || b.local === null) return a.local === b.local ? 0 : a.local === null ? -1 : 1;
  for (let i = 0; i < Math.min(a.local.length, b.local.length); i++) {
    const [at, av] = a.local[i], [bt, bv] = b.local[i];
    if (at !== bt) return at < bt ? -1 : 1;
    const order = at ? comparePythonInteger(av, bv) : av < bv ? -1 : av > bv ? 1 : 0; if (order) return order;
  }
  return Math.sign(a.local.length - b.local.length);
}
export function pypiIdentity(name, version) {
  if (typeof name !== "string" || name.length > 128 || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) throw Error("Unsupported literal Python distribution name.");
  parsePypiVersion(version);
  return { ecosystem: "PyPI", name: name.toLowerCase().replace(/[-_.]+/g, "-"), version };
}
export function pypiExtras(values) {
  if (!Array.isArray(values) || values.length > 64) throw Error("Unsupported bounded Python extras.");
  return [...new Set(values.map(value => pypiIdentity(value, "0").name))].sort();
}
const pythonMarkerVariables = new Set(["python_version", "python_full_version", "os_name", "sys_platform", "platform_release", "platform_system", "platform_version", "platform_machine", "platform_python_implementation", "implementation_name", "implementation_version"]);
export function validatePypiMarker(value) {
  exact(value, ["sha256", "variables"]); digest(value.sha256);
  if (!Array.isArray(value.variables) || value.variables.length > 11 || value.variables.some(v => !pythonMarkerVariables.has(v)) || JSON.stringify(value.variables) !== JSON.stringify([...new Set(value.variables)].sort())) throw Error("Invalid Python marker declaration metadata.");
  return value;
}
/** Parse a bounded PEP 508 grammar without evaluating it or exporting literals. */
function pythonMarkerDeclaration(value) {
  const refuse = () => { throw Error("Unsupported bounded Python environment marker."); };
  if (!value || value.length > 2048 || /[^\x20-\x7e\t]|\\| -/.test(value)) refuse();
  const tokens = [], variables = new Set(); let offset = 0;
  while (offset < value.length) {
    if (/[ \t]/.test(value[offset])) { offset++; continue; }
    if (tokens.length >= 256) refuse();
    const char = value[offset];
    if (char === '"' || char === "'") {
      const end = value.indexOf(char, offset + 1); if (end < 0) refuse();
      tokens.push({ kind: "operand" }); offset = end + 1; continue;
    }
    const match = /^(?:not[ \t]+in\b|===|==|!=|<=|>=|~=|[<>()]|[A-Za-z_]+)/.exec(value.slice(offset));
    if (!match) refuse();
    const word = match[0]; offset += word.length;
    if (pythonMarkerVariables.has(word)) { variables.add(word); tokens.push({ kind: "operand" }); }
    else if (["and", "or", "(", ")"].includes(word)) tokens.push({ kind: word });
    else if (/^(?:===|==|!=|<=|>=|~=|<|>|in|not[ \t]+in)$/.test(word)) tokens.push({ kind: "compare" });
    else refuse();
  }
  let index = 0;
  const take = kind => tokens[index]?.kind === kind ? (++index, true) : false;
  const expression = depth => {
    if (take("(")) { if (depth >= 16) refuse(); disjunction(depth + 1); if (!take(")")) refuse(); }
    else if (!take("operand") || !take("compare") || !take("operand")) refuse();
  };
  const conjunction = depth => { expression(depth); while (take("and")) expression(depth); };
  const disjunction = depth => { conjunction(depth); while (take("or")) conjunction(depth); };
  disjunction(0); if (index !== tokens.length) refuse();
  return { sha256: sha(value), variables: [...variables].sort() };
}
export const isPinnedRequirementsPath = path => typeof path === "string" && /(?:^|\/)requirements(?:[-_.][A-Za-z0-9_-]+)?\.(?:txt|lock)$/i.test(path);
/** A closed metadata subset, never pip, a resolver, includes or index access. */
export function parsePinnedRequirements(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 256 * 1024 || /[\0\v\f]/.test(text) || /\r(?!\n)/.test(text)) throw Error("Unsupported bounded Python requirements input.");
  const lines = text.replace(/\r\n/g, "\n").split("\n"); if (lines.length > 8192) throw Error("Python requirements exceed their line bound.");
  const components = [], names = new Set(); let pending = "", continuing = false;
  for (const raw of lines) {
    // pip joins physical lines before stripping comments. A comment-only line
    // ends a continuation; a trailing backslash inside that comment is inert.
    const comment = /^\s*#/.test(raw); continuing = raw.endsWith("\\") && !comment;
    const part = comment ? " " + raw : continuing ? raw.slice(0, -1) : raw;
    if (pending.length + part.length > 8192) throw Error("Unsupported Python requirements continuation.");
    pending += part;
    if (continuing) continue;
    const line = pending.replace(/(?:^|\s)#.*$/, "").trim(); pending = "";
    if (!line) continue;
    const hashes = /[ \t]+((?:--hash=sha256:[a-f0-9]{64})(?:[ \t]+--hash=sha256:[a-f0-9]{64})*)$/.exec(line);
    const declaration = hashes ? line.slice(0, hashes.index) : line;
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)[ \t]*(?:\[([^\[\]]*)\][ \t]*)?==[ \t]*([A-Za-z0-9.!+_-]{1,128})[ \t]*(?:;[ \t]*(.*))?$/.exec(declaration);
    if (!match) throw Error("Requirements outside the exact version-pin/hash subset are unsupported.");
    const identity = pypiIdentity(match[1], match[3]), extras = match[2]?.trim() ? pypiExtras(match[2].split(",").map(value => value.trim())) : [], declaredSha256 = hashes ? hashes[1].split(/[ \t]+/).map(value => value.slice(14)).sort() : [];
    const marker = match[4] === undefined ? undefined : pythonMarkerDeclaration(match[4].trim());
    if (names.has(identity.name) || declaredSha256.length > 64 || new Set(declaredSha256).size !== declaredSha256.length || components.length >= 4096) throw Error("Duplicate or excessive Python requirements metadata.");
    names.add(identity.name); components.push({ ...identity, declaredSha256, ...(extras.length ? { extras } : {}), ...(marker ? { marker } : {}) });
  }
  if (continuing) throw Error("Unfinished Python requirements continuation.");
  return components;
}
function npmLocationName(location) {
  scannerPath(location);
  const parts = location.split("/"), index = parts.lastIndexOf("node_modules");
  if (parts.includes(".git")) throw Error("Unsupported npm package location.");
  if (index < 0) return null;
  const name = parts.slice(index + 1).join("/");
  if (!npmName(name)) throw Error("Unsupported npm installed name.");
  return name;
}
/** Deliberately bounded declaration subset: one canonical SHA-512 SRI value. */
export function npmArtifactSha512(value) {
  if (typeof value !== "string" || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return null;
  const encoded = value.slice(7), bytes = Buffer.from(encoded, "base64");
  return bytes.length === 64 && bytes.toString("base64") === encoded ? bytes.toString("hex") : null;
}
const artifactKey = (lockPath, location) => JSON.stringify([lockPath, location]);
const archiveLimit = 4 * 1024 * 1024;
const archiveReasons = ["compression", "bounds", "format", "headers", "paths", "manifest", "budget"];
const archiveRefuse = reason => { const error = new Error("Unsupported bounded package archive."); error.archiveReason = reason; throw error; };
function archiveString(bytes) {
  const end = bytes.indexOf(0), value = end < 0 ? bytes : bytes.subarray(0, end);
  if (value.some(b => b < 32 || b > 126) || end >= 0 && bytes.subarray(end).some(b => b !== 0)) archiveRefuse("headers");
  return value.toString("ascii");
}
function archiveOctal(bytes) {
  const text = bytes.toString("latin1");
  if (!/^[ 0]*[0-7]+[ \0]+$/.test(text)) archiveRefuse("headers");
  const value = Number.parseInt(text.replace(/[ \0]+$/, "").trim(), 8);
  if (!Number.isSafeInteger(value) || value < 0) archiveRefuse("headers");
  return value;
}
function archiveManifest(bytes) {
  // JSON.parse alone silently selects the last duplicate key.
  let text, value;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); value = JSON.parse(text); }
  catch { archiveRefuse("manifest"); }
  if (!object(value)) archiveRefuse("manifest");
  const stack = [], token = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|[{}\[\]]/g;
  for (const match of text.matchAll(token)) {
    const item = match[0];
    if (item === "{" || item === "[") { stack.push(item === "{" ? new Set() : null); if (stack.length > 32) archiveRefuse("manifest"); }
    else if (item === "}" || item === "]") stack.pop();
    else if (/^[ \t\r\n]*:/.test(text.slice(match.index + item.length))) {
      const keys = stack.at(-1), key = JSON.parse(item);
      if (!keys || keys.has(key)) archiveRefuse("manifest");
      keys.add(key);
    }
  }
  if (!npmName(value.name) || !npmVersion(value.version)) archiveRefuse("manifest");
  const declaration = npmLicenseDeclaration(value.license);
  const license = Object.hasOwn(value, "licenses") ? { status: "unsupported" } : !Object.hasOwn(value, "license") ? { status: "missing" }
    : typeof value.license === "string" && /^SEE LICENSE IN [\x21-\x7e][\x20-\x7e]{0,495}$/.test(value.license) ? { status: "file-only" }
    : declaration && declaration.expression.toUpperCase() !== "UNLICENSED" ? { status: "declared", expression: declaration.expression } : { status: "unsupported" };
  return { name: value.name, version: value.version, manifestSha256: sha(bytes), license };
}
/** Metadata comparison only. Never extracts paths or executes archive contents. */
function inspectTarArchive(bytes, budget, cargo = false) {
  try {
    if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0 || budget.remaining > 32 * 1024 * 1024) archiveRefuse("bounds");
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 2 * 1024 * 1024) archiveRefuse("bounds");
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) archiveRefuse("compression");
    const allowance = Math.min(archiveLimit, budget.remaining);
    if (!allowance) archiveRefuse("budget");
    // Reserve before decompression. A failed attempt consumes the allowance;
    // successful decompression charges its actual bytes, even for invalid tar.
    budget.remaining -= allowance;
    let tar;
    try { tar = gunzipSync(bytes, { maxOutputLength: allowance }); }
    catch (error) { archiveRefuse(error.code === "ERR_BUFFER_TOO_LARGE" ? allowance < archiveLimit ? "budget" : "bounds" : "compression"); }
    budget.remaining += allowance - tar.length;
    if (tar.length < 1536 || tar.length % 512 !== 0) archiveRefuse("format");
    let offset = 0, entries = 0, manifest = null, terminated = false, archiveRoot = cargo ? null : "package";
    const paths = new Map();
    while (offset + 512 <= tar.length) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every(b => b === 0)) {
        if (tar.length - offset < 1024 || tar.subarray(offset).some(b => b !== 0)) archiveRefuse("format");
        terminated = true; break;
      }
      if (++entries > 1024) archiveRefuse("bounds");
      if (!header.subarray(257, 265).equals(Buffer.from("ustar\0" + "00")) || header.subarray(500).some(b => b !== 0)) archiveRefuse("format");
      const checksum = archiveOctal(header.subarray(148, 156));
      let observed = 0;
      for (let i = 0; i < 512; i++) observed += i >= 148 && i < 156 ? 32 : header[i];
      if (checksum !== observed) archiveRefuse("headers");
      const size = archiveOctal(header.subarray(124, 136)), kind = header[156];
      if (![0, 48, 53].includes(kind) || header.subarray(157, 257).some(b => b !== 0)) archiveRefuse("format");
      for (const [start, length] of [[100, 8], [136, 12]]) archiveOctal(header.subarray(start, start + length));
      // npm's portable tar writer omits uid/gid entirely. Only these unused
      // owner fields may be all NUL; size/mode/time/checksum still require octal.
      for (const start of [108, 116]) if (header.subarray(start, start + 8).some(b => b !== 0)) archiveOctal(header.subarray(start, start + 8));
      // Owner/mode values are never applied. Extension fields cannot acquire
      // extractor-specific interpretations in this deliberately bounded subset.
      archiveString(header.subarray(265, 297)); archiveString(header.subarray(297, 329));
      for (const start of [329, 337]) if (header.subarray(start, start + 8).some(b => b !== 0) && archiveOctal(header.subarray(start, start + 8)) !== 0) archiveRefuse("format");
      const name = archiveString(header.subarray(0, 100)), prefix = archiveString(header.subarray(345, 500));
      const rawPath = prefix ? prefix + "/" + name : name, directory = kind === 53;
      const path = directory && rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
      const parts = path.split("/");
      if (archiveRoot === null) { if (!/^[A-Za-z_][A-Za-z0-9_.+-]{0,320}$/.test(parts[0])) archiveRefuse("paths"); archiveRoot = parts[0]; }
      if (parts[0] !== archiveRoot || parts.length > 32 || parts.some(p => !p || p === "." || p === ".." || /[\\:\x00-\x1f]/.test(p))
          || !directory && (path === archiveRoot || rawPath.endsWith("/")) || directory && size !== 0) archiveRefuse("paths");
      const identity = path.toLowerCase();
      if (paths.has(identity)) archiveRefuse("paths");
      paths.set(identity, directory);
      const end = offset + 512 + size, next = offset + 512 + Math.ceil(size / 512) * 512;
      if (end > tar.length || next > tar.length || tar.subarray(end, next).some(b => b !== 0)) archiveRefuse("format");
      const manifestPath = archiveRoot + (cargo ? "/Cargo.toml" : "/package.json");
      if (identity === manifestPath.toLowerCase()) {
        if (path !== manifestPath || directory || size === 0 || size > 65536) archiveRefuse("manifest");
        manifest = (cargo ? cargoArchiveManifest : archiveManifest)(tar.subarray(offset + 512, end));
      }
      offset = next;
    }
    if (!terminated || !manifest || cargo && archiveRoot !== manifest.name + "-" + manifest.version) archiveRefuse("manifest");
    for (const path of paths.keys()) {
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) if (paths.get(parts.slice(0, i).join("/")) === false) archiveRefuse("paths");
    }
    return { status: "inspected", ...manifest, entries, expandedBytes: tar.length };
  } catch (error) {
    if (!archiveReasons.includes(error.archiveReason)) throw error;
    return { status: "unsupported", reason: error.archiveReason };
  }
}
export const inspectNpmArchive = (bytes, budget = { remaining: archiveLimit }) => inspectTarArchive(bytes, budget);
export const inspectCargoArchive = (bytes, budget = { remaining: archiveLimit }) => inspectTarArchive(bytes, budget, true);
// Archive-only grammar. Cargo.lock keeps its separate, narrower contract.
const cargoLiteral = /^'[^'\x00-\x1f]*'/;
function cargoManifestString(value) {
  const token = value[0] === "'" ? cargoLiteral.exec(value) : cargoQuoted.exec(value);
  cargoRequire(token?.[0] === value);
  const parsed = value[0] === "'" ? value.slice(1, -1) : JSON.parse(value);
  cargoRequire(parsed.length <= 2048 && parsed.isWellFormed() && !/[\x00-\x1f\x7f]/.test(parsed));
  return parsed;
}
function cargoManifestUncomment(line) {
  let result = "", rest = line;
  while (rest) {
    if (rest[0] === "#") break;
    if (["'", '"'].includes(rest[0])) {
      const token = (rest[0] === "'" ? cargoLiteral : cargoQuoted).exec(rest); cargoRequire(token);
      result += token[0]; rest = rest.slice(token[0].length);
    } else { cargoRequire(/^[\t\x20-\x7e]$/.test(rest[0])); result += rest[0]; rest = rest.slice(1); }
  }
  return result.trim();
}
function cargoManifestKey(value) {
  const quoted = ["'", '"'].includes(value[0]), token = (quoted ? value[0] === "'" ? cargoLiteral : cargoQuoted : /^[A-Za-z0-9_-]+/).exec(value);
  cargoRequire(token && token[0].length <= 8192);
  return { name: quoted ? cargoManifestString(token[0]) : token[0], rest: value.slice(token[0].length).trim() };
}
function cargoManifestTable(value) {
  const parts = []; let rest = value.trim();
  while (rest) {
    const key = cargoManifestKey(rest); parts.push(key.name); cargoRequire(parts.length <= 16);
    rest = key.rest; if (!rest) break;
    cargoRequire(rest[0] === "."); rest = rest.slice(1).trim(); cargoRequire(rest);
  }
  cargoRequire(parts.length); return parts;
}
function cargoManifestValue(input, depth = 0) {
  let rest = input.trim(), value;
  if (["'", '"'].includes(rest[0])) {
    const token = (rest[0] === "'" ? cargoLiteral : cargoQuoted).exec(rest); cargoRequire(token);
    value = cargoManifestString(token[0]); rest = rest.slice(token[0].length).trim();
  } else if (rest[0] === "[") {
    value = []; rest = rest.slice(1).trim();
    while (rest[0] !== "]") {
      const token = (rest[0] === "'" ? cargoLiteral : cargoQuoted).exec(rest); cargoRequire(token && value.length < 4096);
      value.push(cargoManifestString(token[0])); rest = rest.slice(token[0].length).trim();
      if (rest[0] === "]") break;
      cargoRequire(rest[0] === ","); rest = rest.slice(1).trim();
    }
    rest = rest.slice(1).trim();
  } else if (rest[0] === "{") {
    cargoRequire(depth < 16); value = new Map(); rest = rest.slice(1).trim();
    while (rest[0] !== "}") {
      const key = cargoManifestKey(rest); cargoRequire(!value.has(key.name) && key.rest[0] === "=");
      const item = cargoManifestValue(key.rest.slice(1), depth + 1);
      value.set(key.name, item.value); rest = item.rest;
      if (rest[0] === "}") break;
      cargoRequire(rest[0] === ","); rest = rest.slice(1).trim(); cargoRequire(rest[0] !== "}");
    }
    rest = rest.slice(1).trim();
  } else {
    const token = /^[^,\]}\s]+/.exec(rest); cargoRequire(token); const scalar = token[0];
    if (["true", "false"].includes(scalar)) value = scalar === "true";
    else { cargoRequire(/^[+-]?(?:0|[1-9][0-9]{0,18})$/.test(scalar)); value = BigInt(scalar); cargoRequire(value >= -9223372036854775808n && value <= 9223372036854775807n); }
    rest = rest.slice(scalar.length).trim();
  }
  return { value, rest };
}
/** Closed TOML subset: single-line basic/literal strings, string arrays,
 * booleans, decimal integers, quoted/bare keys, ordinary, array and inline tables. Unsupported
 * syntax refuses the entire manifest, including metadata after its identity.
 * A Map tree preserves literal dots and key aliases without prototype effects. */
function cargoArchiveManifest(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    cargoRequire(!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]|\r(?!\n)/.test(text));
    const lines = text.replaceAll("\r\n", "\n").split("\n"), identity = {};
    cargoRequire(lines.length <= 2048 && lines.every(line => line.length <= 8192));
    const node = () => ({ kind: "table", explicit: false, children: new Map() }), root = node();
    let table = [], current = root, pending = "", key; const licenseFields = new Map();
    const store = (name, value) => {
      cargoRequire(!current.children.has(name));
      const parsed = cargoManifestValue(value); cargoRequire(!parsed.rest);
      current.children.set(name, { kind: "scalar" });
      if (table.length === 1 && table[0] === "package" && ["name", "version"].includes(name)) { cargoRequire(typeof parsed.value === "string"); identity[name] = parsed.value; }
      if (table.length === 1 && table[0] === "package" && ["license", "license-file"].includes(name)) licenseFields.set(name, parsed.value);
    };
    for (const raw of lines) {
      const line = cargoManifestUncomment(raw); if (!line) continue;
      if (pending) { cargoRequire(pending.length + line.length <= 65536); pending += " " + line; if (line.endsWith("]")) { store(key, pending); pending = ""; } continue; }
      if (line.startsWith("[")) {
        const array = line.startsWith("[["), width = array ? 2 : 1;
        cargoRequire(line.endsWith(array ? "]]" : "]"));
        table = cargoManifestTable(line.slice(width, -width)); current = root;
        for (let i = 0; i < table.length; i++) {
          const part = table[i], last = i === table.length - 1;
          if (!current.children.has(part)) current.children.set(part, last && array ? { kind: "array-table", items: [] } : node());
          const child = current.children.get(part);
          if (last && array) {
            cargoRequire(child.kind === "array-table"); current = node(); child.items.push(current);
          } else {
            current = !last && child.kind === "array-table" ? child.items.at(-1) : child;
            cargoRequire(current?.kind === "table");
          }
        }
        cargoRequire(!current.explicit); current.explicit = true; continue;
      }
      const field = cargoManifestKey(line); key = field.name; cargoRequire(field.rest.startsWith("="));
      const value = field.rest.slice(1).trim(); cargoRequire(value);
      if (value.startsWith("[") && !value.endsWith("]")) pending = value; else store(key, value);
    }
    cargoRequire(!pending && root.children.get("package")?.explicit); cargoIdentity(identity.name, identity.version);
    const fields = root.children.get("package").children, declaration = npmLicenseDeclaration(licenseFields.get("license"));
    const fileUnsupported = fields.has("license-file") && (typeof licenseFields.get("license-file") !== "string" || !licenseFields.get("license-file"));
    const license = fileUnsupported ? { status: "unsupported" } : fields.has("license") ? declaration ? { status: "declared", expression: declaration.expression } : { status: "unsupported" } : { status: fields.has("license-file") ? "file-only" : "missing" };
    return { ...identity, manifestSha256: sha(bytes), license };
  } catch { archiveRefuse("manifest"); }
}
export function validateCargoArchiveObservation(value, name, version) {
  validateTarArchiveObservation(value, name, version, (n, v) => { try { cargoIdentity(n, v); return true; } catch { return false; } }, true);
}
export function validateNpmArchiveObservation(value, name, version) {
  validateTarArchiveObservation(value, name, version, (n, v) => npmName(n) && npmVersion(v), true);
  if (value.license?.status === "declared" && value.license.expression.toUpperCase() === "UNLICENSED") throw Error("An npm UNLICENSED marker is not an assessed SPDX declaration.");
}
function validateTarArchiveObservation(value, name, version, identity, cargo = false) {
  if (value?.status === "unsupported") { exact(value, ["status", "reason"]); if (!archiveReasons.includes(value.reason)) throw Error("Invalid archive coverage gap."); return; }
  exact(value, ["status", "name", "version", "manifestSha256", "entries", "expandedBytes", ...(cargo ? ["license"] : [])]);
  if (cargo) {
    const license = value.license; exact(license, license?.status === "declared" ? ["status", "expression"] : ["status"]);
    cargoRequire(license.status === "declared" ? npmLicenseDeclaration(license.expression)?.expression === license.expression : ["missing", "file-only", "unsupported"].includes(license.status));
  }
  if (!identity(value.name, value.version) || !/^[a-f0-9]{64}$/.test(value.manifestSha256 ?? "")
      || !Number.isSafeInteger(value.entries) || value.entries < 1 || value.entries > 1024
      || !Number.isSafeInteger(value.expandedBytes) || value.expandedBytes < (value.entries + 3) * 512 || value.expandedBytes > archiveLimit || value.expandedBytes % 512
      || value.status !== (value.name === name && value.version === version ? "matched" : "mismatched")) throw Error("Archive identity observation is inconsistent.");
}
const wheelMetadataVersions = ["1.1", "1.2", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6"];
function wheelHeaders(bytes, selected) {
  if (!bytes?.length || bytes.length > 65536) archiveRefuse("manifest");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { archiveRefuse("manifest"); }
  if (/[\0\v\f]|\r(?!\n)/.test(text)) archiveRefuse("manifest");
  const lines = text.replaceAll("\r\n", "\n").split("\n"), result = new Map(); let previous;
  if (lines.length > 2048) archiveRefuse("manifest");
  for (const line of lines) {
    if (!line) break;
    if (line.length > 8192) archiveRefuse("manifest");
    if (/^[ \t]/.test(line)) { if (!previous || selected.includes(previous)) archiveRefuse("manifest"); continue; }
    const match = /^([A-Za-z][A-Za-z0-9-]{0,63}):[ \t]*(.*)$/.exec(line); if (!match) archiveRefuse("manifest");
    previous = match[1].toLowerCase();
    if (selected.includes(previous)) { if (result.has(previous)) archiveRefuse("manifest"); result.set(previous, match[2].trim()); }
  }
  if (result.size !== selected.length) archiveRefuse("manifest");
  return result;
}
function wheelLicenseDeclaration(bytes, metadataVersion) {
  // Identity parsing already verified UTF-8, header shape and byte/line bounds.
  // Stop at the header/body boundary; a description cannot supply authority.
  const fields = new Map(); let previous;
  for (const line of bytes.toString("utf8").replaceAll("\r\n", "\n").split("\n")) {
    if (!line) break;
    if (/^[ \t]/.test(line)) { if (fields.has(previous)) fields.get(previous)[fields.get(previous).length - 1] += " " + line.trim(); continue; }
    const match = /^([A-Za-z][A-Za-z0-9-]{0,63}):[ \t]*(.*)$/.exec(line); previous = match[1].toLowerCase();
    if (["license-expression", "license-file", "license"].includes(previous)) {
      if (fields.has(previous) && previous !== "license-file") archiveRefuse("manifest");
      if (!fields.has(previous)) fields.set(previous, []); fields.get(previous).push(match[2].trim());
    }
  }
  if (!fields.size) return { status: "missing" };
  if (!["2.4", "2.5", "2.6"].includes(metadataVersion) || fields.has("license")) return { status: "unsupported" };
  const expression = fields.get("license-expression");
  if (expression) { const declaration = npmLicenseDeclaration(expression[0]); return declaration ? { status: "declared", expression: declaration.expression } : { status: "unsupported" }; }
  return { status: fields.get("license-file").every(p => p.length > 0 && p.length <= 512 && /^[\x20-\x7e]+$/.test(p)) ? "file-only" : "unsupported" };
}
function inspectWheelRecord(bytes, rows, prefix) {
  const digest = sha(bytes), unsupported = reason => ({ status: "unsupported", sha256: digest, reason });
  if (bytes.length > 256 * 1024) return unsupported("bounds");
  if (bytes.some(b => b !== 10 && b !== 13 && (b < 32 || b > 126))) return unsupported("format");
  const text = bytes.toString("ascii"); if (/\r(?!\n)/.test(text)) return unsupported("format");
  const lines = text.replaceAll("\r\n", "\n").split("\n"); if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.length > 1024) return unsupported("bounds");
  const self = prefix + "/RECORD", signatures = new Set([self + ".jws", self + ".p7s"]), members = new Map(rows.filter(r => !r.directory).map(r => [r.path, r])), seen = new Set();
  const files = [...members.keys()].filter(p => p !== self && !signatures.has(p)).length;
  let mismatch = false, gap;
  for (const line of lines) {
    if (line.length > 1024) return unsupported("bounds");
    const match = /^(?:"([^"]*)"|([^",]*)),(?:"([^"]*)"|([^",]*)),(?:"([^"]*)"|([^",]*))$/.exec(line);
    if (!match) return unsupported("format");
    const path = match[1] ?? match[2], hash = match[3] ?? match[4], size = match[5] ?? match[6], row = members.get(path);
    if (seen.has(path) || !row || signatures.has(path)) { mismatch = true; continue; } seen.add(path);
    if (path === self) { if (hash || size) mismatch = true; continue; }
    if (!hash) { mismatch = true; continue; }
    const parts = /^(sha256|sha384|sha512)=([A-Za-z0-9_-]+)$/.exec(hash);
    if (!parts) { gap = "algorithm"; continue; }
    const digest = Buffer.from(parts[2], "base64url");
    if (digest.length !== Number(parts[1].slice(3)) / 8 || digest.toString("base64url") !== parts[2] || !/^(?:0|[1-9][0-9]{0,6})$/.test(size)) { gap = "format"; continue; }
    if (Number(size) !== row.size || !createHash(parts[1]).update(row.content).digest().equals(digest)) mismatch = true;
  }
  if ([...members.keys()].some(p => !signatures.has(p) && !seen.has(p))) mismatch = true;
  return mismatch ? { status: "mismatched", sha256: digest, files } : gap ? unsupported(gap) : { status: "verified", sha256: digest, files };
}
/** Bounded ZIP/metadata and RECORD checks: never extracts, imports or installs a wheel. */
export function inspectPypiWheel(bytes, budget = { remaining: archiveLimit }) {
  try {
    if (!Number.isSafeInteger(budget.remaining) || budget.remaining < 0 || budget.remaining > 32 * 1024 * 1024 || !Buffer.isBuffer(bytes) || bytes.length > 2 * 1024 * 1024) archiveRefuse("bounds");
    if (bytes.length < 22) archiveRefuse("format");
    const u16 = p => bytes.readUInt16LE(p), u32 = p => bytes.readUInt32LE(p), end = bytes.length - 22;
    if (u32(end) !== 0x06054b50 || u16(end + 4) || u16(end + 6) || u16(end + 20)) archiveRefuse("format");
    const count = u16(end + 10), central = u32(end + 16);
    if (!count || count > 1024 || count !== u16(end + 8) || central > end || central + u32(end + 12) !== end) archiveRefuse("bounds");
    const rows = [], paths = new Map(); let cursor = central, total = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) archiveRefuse("headers");
      const flags = u16(cursor + 8), method = u16(cursor + 10), needed = u16(cursor + 6), nameLength = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32), attributes = u32(cursor + 38);
      if (![0, 8].includes(method)) archiveRefuse("compression");
      if (flags & ~0x800 || needed < 10 || needed > 20 || ![0, 3].includes(u16(cursor + 4) >>> 8) || extra || comment || u16(cursor + 34) || !nameLength || nameLength > 512 || cursor + 46 + nameLength > end) archiveRefuse("headers");
      const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
      if (nameBytes.some(b => b < 33 || b > 126)) archiveRefuse("paths");
      const raw = nameBytes.toString("ascii"), directory = raw.endsWith("/"), path = directory ? raw.slice(0, -1) : raw, parts = path.split("/"), type = (attributes >>> 16) & 0xf000;
      if (parts.length > 32 || parts.some(p => !p || p === "." || p === ".." || /[\\:<>"|?*]|[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) || type && type !== (directory ? 0x4000 : 0x8000) || attributes & 0x10 && !directory || paths.has(path.toLowerCase())) archiveRefuse("paths");
      const size = u32(cursor + 24), compressed = u32(cursor + 20), offset = u32(cursor + 42);
      if (size > archiveLimit || compressed > bytes.length || directory && (size || compressed)) archiveRefuse("bounds");
      total += size; if (total > archiveLimit) archiveRefuse("bounds");
      paths.set(path.toLowerCase(), directory); rows.push({ path, nameBytes, directory, size, compressed, offset, crc: u32(cursor + 16), flags, method, needed, time: u32(cursor + 12) });
      cursor += 46 + nameLength;
    }
    if (cursor !== end) archiveRefuse("format");
    for (const path of paths.keys()) { const parts = path.split("/"); for (let i = 1; i < parts.length; i++) if (paths.get(parts.slice(0, i).join("/")) === false) archiveRefuse("paths"); }
    const allowance = Math.min(archiveLimit, budget.remaining); if (!allowance || total > allowance) archiveRefuse("budget");
    budget.remaining -= allowance;
    const metadata = new Map(); let offset = 0, expanded = 0;
    for (const row of rows.sort((a, b) => a.offset - b.offset)) {
      const p = row.offset;
      if (p !== offset || p + 30 > central || u32(p) !== 0x04034b50 || u16(p + 4) !== row.needed || u16(p + 6) !== row.flags || u16(p + 8) !== row.method || u32(p + 10) !== row.time || u32(p + 14) !== row.crc || u32(p + 18) !== row.compressed || u32(p + 22) !== row.size || u16(p + 26) !== row.nameBytes.length || u16(p + 28)) archiveRefuse("headers");
      const start = p + 30 + row.nameBytes.length, stop = start + row.compressed;
      if (stop > central || !bytes.subarray(p + 30, start).equals(row.nameBytes)) archiveRefuse("headers");
      let content = bytes.subarray(start, stop);
      if (row.method === 8) {
        let result;
        try { result = inflateRawSync(content, { maxOutputLength: Math.max(1, row.size), info: true }); } catch (error) { archiveRefuse(error.code === "ERR_BUFFER_TOO_LARGE" ? "bounds" : "compression"); }
        if (result.engine.bytesWritten !== content.length) archiveRefuse("compression"); content = result.buffer;
      }
      if (content.length !== row.size || crc32(content) !== row.crc) archiveRefuse("headers");
      row.content = content;
      expanded += content.length; offset = stop;
      if (/^[^/]+\.dist-info\/(?:METADATA|WHEEL|RECORD)$/.test(row.path)) { if (row.directory) archiveRefuse("manifest"); metadata.set(row.path, content); }
    }
    if (offset !== central || expanded !== total) archiveRefuse("format");
    const roots = [...new Set(rows.map(r => r.path.split("/")[0]).filter(p => p.endsWith(".dist-info")))];
    if (roots.length !== 1) archiveRefuse("manifest");
    const prefix = roots[0], match = /^([A-Za-z0-9_.]+)-([A-Za-z0-9.!+_]+)\.dist-info$/.exec(prefix), manifest = metadata.get(prefix + "/METADATA");
    if (!match || !metadata.get(prefix + "/RECORD")?.length) archiveRefuse("manifest");
    const fields = wheelHeaders(manifest, ["metadata-version", "name", "version"]), wheel = wheelHeaders(metadata.get(prefix + "/WHEEL"), ["wheel-version"]);
    const metadataVersion = fields.get("metadata-version"), wheelVersion = wheel.get("wheel-version"); let identity;
    try { identity = pypiIdentity(fields.get("name"), fields.get("version")); if (pypiIdentity(match[1], match[2]).name !== identity.name || pypiVersionKey(match[2]) !== pypiVersionKey(identity.version)) archiveRefuse("manifest"); } catch { archiveRefuse("manifest"); }
    if (!wheelMetadataVersions.includes(metadataVersion) || wheelVersion !== "1.0") archiveRefuse("manifest");
    const license = wheelLicenseDeclaration(manifest, metadataVersion);
    budget.remaining += allowance - expanded;
    return { status: "inspected", name: identity.name, version: identity.version, metadataVersion, wheelVersion, manifestSha256: sha(manifest), entries: count, expandedBytes: expanded, record: inspectWheelRecord(metadata.get(prefix + "/RECORD"), rows, prefix), license };
  } catch (error) { if (!archiveReasons.includes(error.archiveReason)) throw error; return { status: "unsupported", reason: error.archiveReason }; }
}
export function validatePypiWheelObservation(value, name, version) {
  if (value?.status === "unsupported") { exact(value, ["status", "reason"]); if (!archiveReasons.includes(value.reason)) throw Error("Invalid wheel coverage gap."); return; }
  exact(value, ["status", "name", "version", "metadataVersion", "wheelVersion", "manifestSha256", "entries", "expandedBytes", "record", "license"]);
  if (pypiIdentity(value.name, value.version).name !== value.name || !wheelMetadataVersions.includes(value.metadataVersion) || value.wheelVersion !== "1.0" || !/^[a-f0-9]{64}$/.test(value.manifestSha256 ?? "") || !Number.isSafeInteger(value.entries) || value.entries < 3 || value.entries > 1024 || !Number.isSafeInteger(value.expandedBytes) || value.expandedBytes < 1 || value.expandedBytes > archiveLimit || value.status !== (value.name === name && pypiVersionKey(value.version) === pypiVersionKey(version) ? "matched" : "mismatched")) throw Error("Wheel identity observation is inconsistent.");
  const r = value.record; exact(r, ["status", "sha256", r?.status === "unsupported" ? "reason" : "files"]);
  if (!/^[a-f0-9]{64}$/.test(r.sha256 ?? "") || (r.status === "unsupported" ? !["bounds", "format", "algorithm"].includes(r.reason) : !["verified", "mismatched"].includes(r.status) || !Number.isSafeInteger(r.files) || r.files < 2 || r.files >= value.entries)) throw Error("Invalid wheel RECORD observation.");
  const license = value.license; exact(license, license?.status === "declared" ? ["status", "expression"] : ["status"]);
  if (license.status === "declared" ? npmLicenseDeclaration(license.expression)?.expression !== license.expression : !["missing", "file-only", "unsupported"].includes(license.status)) throw Error("Invalid wheel license declaration.");
  if (["declared", "file-only"].includes(license.status) && !["2.4", "2.5", "2.6"].includes(value.metadataVersion)) throw Error("Wheel license declarations require supporting metadata versions.");
}
function archiveProperties(archive) {
  return archive ? [{ name: "switchyard:archive-identity", value: archive.status },
    ...(archive.status === "unsupported" ? [{ name: "switchyard:archive-gap", value: archive.reason }] : [
      { name: "switchyard:archive-manifest-sha256", value: archive.manifestSha256 },
      { name: "switchyard:archive-declared-name", value: archive.name },
      { name: "switchyard:archive-declared-version", value: archive.version },
      ...(archive.metadataVersion ? [{ name: "switchyard:wheel-metadata-version", value: archive.metadataVersion }, { name: "switchyard:wheel-format-version", value: archive.wheelVersion }, { name: "switchyard:wheel-record-verification", value: archive.record.status }, { name: "switchyard:wheel-record-sha256", value: archive.record.sha256 }, ...(archive.record.status === "unsupported" ? [{ name: "switchyard:wheel-record-gap", value: archive.record.reason }] : [{ name: "switchyard:wheel-record-files", value: String(archive.record.files) }])] : [])])] : [];
}
function archiveLicenseProperties(license) {
  return license ? [{ name: "switchyard:archive-license-declaration", value: license.status }, ...(license.status === "declared" ? [{ name: "switchyard:archive-declared-license", value: license.expression }, ...licenseCatalogProperties(license.expression).map(p => ({ ...p, name: p.name.replace("switchyard:spdx-", "switchyard:archive-spdx-") }))] : [])] : [];
}
export const shieldArtifactReferenceKey = row => row.ecosystem === "Cargo"
  ? JSON.stringify(["Cargo", row.lockPath, row.name, row.version, row.sourceSha256])
  : row.ecosystem === "PyPI" ? JSON.stringify(["PyPI", row.requirementsPath, row.name, row.version]) : artifactKey(row.lockPath, row.location);
function workspaceLink(packages, link, cache) {
  if (!object(link) || link.link !== true || Object.keys(link).some(key => !["link", "resolved"].includes(key)) || typeof link.resolved !== "string") throw Error("Unsupported workspace link.");
  const path = scannerPath(link.resolved);
  if (path.split("/").some(part => part === "node_modules" || part === ".git") || !Object.hasOwn(packages, path)) throw Error("Unsupported local workspace target.");
  if (cache.has(path)) return cache.get(path);
  const metadata = packages[path];
  if (!object(metadata) || (metadata.link !== undefined && metadata.link !== false) || Object.hasOwn(metadata, "resolved") || !npmName(metadata.name) || !npmVersion(metadata.version)) throw Error("Workspace metadata is absent or ambiguous.");
  // Hash declared lock metadata once per target; never open its filesystem
  // location, follow a link or execute lifecycle scripts.
  const result = { metadata, workspace: { path, lockMetadataSha256: sha(JSON.stringify(metadata)) } };
  cache.set(path, result); return result;
}
export function shieldCycloneDxComponent(c) { if(c.ecosystem==="Cargo")return cargoCycloneDxComponent(c); return { type: "library", "bom-ref": "switchyard:" + sha(`${c.ecosystem}\0${c.lockPath??c.requirementsPath}\0${c.location??c.name}\0${c.name}\0${c.version}`), name: c.name, version: c.version,
      ...(c.ecosystem === "PyPI" ? { purl: `pkg:pypi/${c.name}@${encodeURIComponent(c.version.toLowerCase()).replaceAll("!", "%21")}` } : {}),
      ...(c.license ? { licenses: [{ license: { name: c.license } }] } : {}), properties: [
        { name: "switchyard:ecosystem", value: c.ecosystem },
        ...licenseCatalogProperties(c.license),
        ...(c.ecosystem === "PyPI" ? [{ name: "switchyard:requirements-file", value: c.requirementsPath }, { name: "switchyard:declared-sha256", value: JSON.stringify(c.declaredSha256) }, { name: "switchyard:python-environment", value: "not-resolved" }, ...(c.extras ? [{ name: "switchyard:python-extras", value: JSON.stringify(c.extras) }] : []), ...(c.marker ? [{ name: "switchyard:python-marker-sha256", value: c.marker.sha256 }, { name: "switchyard:python-marker-variables", value: JSON.stringify(c.marker.variables) }, { name: "switchyard:python-marker-evaluation", value: "not-evaluated" }] : [])] : [{ name: "switchyard:lockfile", value: c.lockPath }, { name: "switchyard:package-location", value: c.location }, { name: "switchyard:installed-as", value: c.installedAs }]),
        ...(c.workspace?[{name:"switchyard:source-kind",value:"workspace-link"},{name:"switchyard:workspace-path",value:c.workspace.path},{name:"switchyard:workspace-lock-metadata-sha256",value:c.workspace.lockMetadataSha256},{name:"switchyard:workspace-source",value:"not-verified"}]:[]),
        ...(c.integritySha256 ? [{ name: "switchyard:integrity-string-sha256", value: c.integritySha256 }] : []),
        ...archiveProperties(c.artifact?.archive),
        ...(c.artifact ? [{ name: "switchyard:artifact-path", value: c.artifact.path }, { name: "switchyard:artifact-sha256", value: c.artifact.sha256 }, ...(c.artifact.algorithm === "sha512" ? [{ name: "switchyard:artifact-observed-sha512", value: c.artifact.observedSha512 }] : []), { name: "switchyard:archive-license-policy", value: c.artifact.licensePolicy }, ...archiveLicenseProperties(c.artifact.archive?.license), { name: "switchyard:artifact-integrity", value: c.artifact.status }, { name: "switchyard:artifact-content", value: "not-inspected" }] : [])
      ] }; }
function feed(v) { exact(v, ["id", "path", "sha256"]); return { id: identifier(v.id), path: scannerPath(v.path), sha256: digest(v.sha256) }; }
function indexSource(v) {
  exact(v, ["kind", "path", "objectId", "mode"]);
  if (v.kind !== "git-index" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v.objectId ?? "") || /^0+$/.test(v.objectId) || !["100644", "100755"].includes(v.mode)) throw Error("Invalid exact index source declaration.");
  const path = scannerPath(v.path);
  if (shieldReservedPath(path)) throw Error("Nested scanner index aliases are refused.");
  return { kind: "git-index", path, objectId: v.objectId, mode: v.mode };
}
function historySource(v){
  exact(v,["kind","path","commit","objectId","mode","depth"]);
  if(v.kind!=="git-history"||![v.commit,v.objectId].every(value=>typeof value==="string"&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)&&!/^0+$/.test(value))||v.commit.length!==v.objectId.length||!["100644","100755"].includes(v.mode)||!Number.isSafeInteger(v.depth)||v.depth<1||v.depth>6)throw Error("Invalid exact historical source declaration.");
  const path=scannerPath(v.path);if(shieldReservedPath(path)||path.length>384||path.split("/").length>28)throw Error("Historical source paths exceed their exact bounds.");
  return{kind:"git-history",path,commit:v.commit,objectId:v.objectId,mode:v.mode,depth:v.depth};
}
export function validateShieldRequest(v) {
  exact(v, ["schema", "version", "action", "scope", "files", "scanner", "advisory", ...(Object.hasOwn(v ?? {}, "packageArtifacts") ? ["packageArtifacts"] : [])]);
  if (v.schema !== "switchyard-shield-scan/v1" || v.version !== 1 || !shieldActions.includes(v.action) || v.scope !== "reviewed-inputs") throw Error("Unsupported Shield request or scope.");
  const files = array(v.files, 512).map(f => {
    exact(f, ["path", "sha256", "size", ...(Object.hasOwn(f ?? {}, "source") ? ["source"] : [])]);
    if (!Number.isSafeInteger(f.size) || f.size < 0 || f.size > 2 * 1024 * 1024) throw Error("Scanner file exceeds its bound.");
    const path = scannerPath(f.path), source = Object.hasOwn(f, "source") ? (f.source?.kind==="git-history"?historySource(f.source):indexSource(f.source)) : undefined;
    if (source ? path !== (source.kind==="git-history"?shieldHistoryPrefix+source.commit+"/":shieldIndexPrefix) + source.path : shieldReservedPath(path)) throw Error("Index inputs require their exact reserved disposable path and original source identity.");
    return { path, sha256: digest(f.sha256), size: f.size, ...(source ? { source } : {}) };
  });
  if (!files.length || files.reduce((n, f) => n + f.size, 0) > 16 * 1024 * 1024 || new Set(files.map(f => f.path.toLowerCase())).size !== files.length) throw Error("Invalid scanner input inventory.");
  const history=files.filter(file=>file.source?.kind==="git-history");
  if(history.length&&(!["shield_codebase_audit","release_shield"].includes(v.action)||history.length>48||new Set(history.map(file=>file.source.path)).size>8||new Set(history.map(file=>file.source.depth)).size!==1))throw Error("Historical scans require one bounded depth and Codebase Audit or Release scope.");
  const scanner = feed(v.scanner), advisory = v.advisory === null ? null : feed(v.advisory);
  if (advisory && (advisory.id === scanner.id || advisory.path.toLowerCase() === scanner.path.toLowerCase()) || files.some(f => [scanner.path, advisory?.path].includes(f.path))) throw Error("Ambiguous scanner inputs.");
  let packageArtifacts;
  if (Object.hasOwn(v, "packageArtifacts")) {
    if (!["shield_supply_chain", "release_shield"].includes(v.action)) throw Error("Package artifacts require a supply-chain or release review.");
    const sources = new Map(files.map(f => [f.path, f])), seen = new Set();
    packageArtifacts = array(v.packageArtifacts, 128).map(row => {
      if (row?.ecosystem === "PyPI") {
        exact(row, ["ecosystem", "requirementsPath", "name", "version", "path"]);
        const requirementsPath = scannerPath(row.requirementsPath), path = scannerPath(row.path), { name, version } = pypiIdentity(row.name, row.version);
        const key = shieldArtifactReferenceKey({ ecosystem: "PyPI", requirementsPath: requirementsPath.toLowerCase(), name, version });
        if (name !== row.name || !isPinnedRequirementsPath(requirementsPath) || !sources.has(requirementsPath) || !sources.has(path) || sources.get(path).size === 0 || path === requirementsPath || seen.has(key)) throw Error("Python artifact references require unique exact reviewed pins, normalized names and file bytes.");
        seen.add(key); return { ecosystem: "PyPI", requirementsPath, name, version, path };
      }
      if (row?.ecosystem === "Cargo") {
        exact(row, ["ecosystem", "lockPath", "name", "version", "sourceSha256", "path"]);
        const lockPath = scannerPath(row.lockPath), path = scannerPath(row.path), { name, version } = cargoIdentity(row.name, row.version), sourceSha256 = digest(row.sourceSha256);
        const key = shieldArtifactReferenceKey({ ecosystem: "Cargo", lockPath: lockPath.toLowerCase(), name, version, sourceSha256 });
        if (!isCargoLockPath(lockPath) || !sources.has(lockPath) || !sources.has(path) || sources.get(path).size === 0 || path === lockPath || seen.has(key)) throw Error("Cargo artifact references require unique exact reviewed identities and file bytes.");
        seen.add(key); return { ecosystem: "Cargo", lockPath, name, version, sourceSha256, path };
      }
      exact(row, ["lockPath", "location", "path"]);
      const lockPath = scannerPath(row.lockPath), path = scannerPath(row.path), location = scannerPath(row.location);
      const key = artifactKey(lockPath, location).toLowerCase();
      if (!sources.has(lockPath) || lockPath.split("/").at(-1) !== "package-lock.json" || !sources.has(path) || sources.get(path).size === 0 || path === lockPath || !npmLocationName(location) || seen.has(key)) throw Error("Artifact references require unique exact reviewed npm locations and file bytes.");
      seen.add(key); return { lockPath, location, path };
    });
    if (!packageArtifacts.length || packageArtifacts.some(row => isCargoLockPath(row.path) || isPinnedRequirementsPath(row.path) || row.path.split("/").at(-1) === "package-lock.json" || packageArtifacts.some(other => row.path === (other.lockPath ?? other.requirementsPath)))) throw Error("Artifact content cannot double as a declared manifest.");
  }
  return { schema: v.schema, version: 1, action: v.action, scope: v.scope, files, scanner, advisory, ...(packageArtifacts ? { packageArtifacts } : {}) };
}
function parseRules(bytes) {
  const v = json(bytes); exact(v, ["schema", "version", "engine", "rules", "allowedLicenses"]);
  if (v.schema !== "switchyard-shield-rules/v1" || v.version !== 1 || v.engine !== shieldEngineVersion) throw Error("Unsupported scanner rule feed.");
  const selected = array(v.rules, 32); if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !Object.hasOwn(rules, id))) throw Error("Unsupported or duplicate scanner rule.");
  const allowedLicenses = array(v.allowedLicenses, 128); if (allowedLicenses.some(s => typeof s !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,79}\+?(?: WITH [A-Za-z0-9][A-Za-z0-9.-]{0,79})?$/.test(s) || npmLicenseDeclaration(s)?.expression !== s) || new Set(allowedLicenses.map(s => s.toLowerCase())).size !== allowedLicenses.length) throw Error("Unsupported license policy.");
  return { selected, allowedLicenses };
}
const advisoryIdentityKey = ({ ecosystem, name, version }) => `${ecosystem}:${name}@${ecosystem === "PyPI" ? pypiVersionKey(version) : version}`;
function parseAdvisories(bytes) {
  const v = json(bytes); exact(v, ["schema", "version", "engine", "packages"]);
  if (v.schema !== "switchyard-shield-advisories/v1" || v.version !== 1 || v.engine !== shieldEngineVersion) throw Error("Unsupported advisory feed.");
  const keys = new Set();
  return array(v.packages, 4096).map(p => {
    exact(p, ["ecosystem", "name", "version", "advisories"]);
    let identity;
    if (p.ecosystem === "npm" && npmName(p.name) && npmVersion(p.version)) identity = { ecosystem: "npm", name: p.name, version: p.version };
    else if (p.ecosystem === "PyPI") identity = pypiIdentity(p.name, p.version);
    else if (p.ecosystem === "crates.io") identity = cratesIoIdentity(p.name,p.version);
    else throw Error("Unsupported advisory package identity.");
    const key = advisoryIdentityKey(identity); if (keys.has(key)) throw Error("Duplicate advisory package."); keys.add(key);
    const advisories = array(p.advisories, 32).map(a => { exact(a, ["id", "severity"]); identifier(a.id); if (!["low", "medium", "high", "critical", "unknown"].includes(a.severity)) throw Error("Invalid advisory severity."); return { id: a.id, severity: a.severity }; });
    if (new Set(advisories.map(a => a.id)).size !== advisories.length) throw Error("Duplicate advisory.");
    return { ...identity, advisories };
  });
}

/** Input reader must return only witnessed bytes. Reports contain no source excerpts. */
export async function scanShieldInputs(proposed, { readInput }) {
  const request = validateShieldRequest(proposed), requested = dimensions[request.action], findings = [], gaps = new Set(["repository_scope_unverified"]), inventory = [], components = []; let dependencyManifests = 0;
  const readFeed = async f => { const b = await readInput(f.path, 2 * 1024 * 1024); if (sha(b) !== f.sha256) throw Error("Scanner feed changed."); return b; };
  const policy = parseRules(await readFeed(request.scanner)), advisory = request.advisory ? parseAdvisories(await readFeed(request.advisory)) : [];
  const advisoryByIdentity = new Map(advisory.map(entry => [advisoryIdentityKey(entry), entry]));
  const add = finding => { if (findings.length < 512) findings.push(finding); else gaps.add("finding_limit"); };
  const artifacts = new Map((request.packageArtifacts ?? []).map(row => [shieldArtifactReferenceKey(row), row])), consumedArtifacts = new Set(), artifactDigests = new Map(), archiveIdentities = new Map(), wheelIdentities = new Map(), cargoIdentities = new Map();
  const npmArtifacts = new Set([...artifacts.values()].filter(row => !row.ecosystem).map(row => row.path)), pythonArtifacts = new Set([...artifacts.values()].filter(row => row.ecosystem === "PyPI").map(row => row.path)), archiveBudget = { remaining: 32 * 1024 * 1024 }, cargoArtifacts = new Set([...artifacts.values()].filter(row => row.ecosystem === "Cargo").map(row => row.path));
  for (const row of artifacts.values()) if (!artifactDigests.has(row.path)) {
    const file = request.files.find(file => file.path === row.path), bytes = await readInput(file.path, file.size);
    if (bytes.length !== file.size || sha(bytes) !== file.sha256) throw Error("Reviewed artifact bytes changed.");
    artifactDigests.set(row.path, { path: file.path, sha256: file.sha256, size: file.size, observedSha512: createHash("sha512").update(bytes).digest("hex") });
    if (cargoArtifacts.has(row.path)) cargoIdentities.set(row.path, inspectCargoArchive(bytes, archiveBudget));
    if (npmArtifacts.has(row.path)) archiveIdentities.set(row.path, inspectNpmArchive(bytes, archiveBudget));
    if (pythonArtifacts.has(row.path)) wheelIdentities.set(row.path, inspectPypiWheel(bytes, archiveBudget));
  }
  if (artifacts.size) gaps.add("artifact_contents_not_inspected");
  for (const file of request.files) {
    const bytes = await readInput(file.path, file.size); if (bytes.length !== file.size || sha(bytes) !== file.sha256) throw Error("Scanner input changed.");
    inventory.push({ path: file.path, sha256: file.sha256, bytes: file.size, ...(file.source ? { source: file.source } : {}) });
    let text;
    try { text = utf8(bytes); if (text.includes("\0")) throw Error("binary"); } catch { gaps.add("binary_or_non_utf8_input"); continue; }
    const extension = file.path.split(".").at(-1).toLowerCase();
    for (const id of policy.selected) {
      const rule = rules[id]; if (!requested.includes(rule.dimension) || rule.extensions && !rule.extensions.includes(extension)) continue;
      rule.pattern.lastIndex = 0; let match;
      while ((match = rule.pattern.exec(text)) !== null) {
        add({ ruleId: id, dimension: rule.dimension, severity: rule.severity, path: file.path, line: text.slice(0, match.index).split("\n").length, fingerprint: sha(`${id}\0${file.path}\0${file.sha256}\0${match.index}`) });
        if (findings.length >= 512) { gaps.add("finding_limit"); break; }
      }
    }
    if (/(?:^|\/)(?:poetry\.lock|uv\.lock|go\.sum|Gemfile\.lock|yarn\.lock|pnpm-lock\.yaml)$/.test(file.path)) gaps.add("unsupported_dependency_ecosystem");
    if (/(?:^|\/)requirements[^/]*\.(?:txt|lock)$/i.test(file.path) && !isPinnedRequirementsPath(file.path)) gaps.add("unsupported_dependency_ecosystem");
    if (isCargoLockPath(file.path) && requested.includes("sbom")) {
      let declared;
      try { declared=parseCargoLock(text); } catch { gaps.add("unsupported_cargo_lock");continue; }
      dependencyManifests++;gaps.add("cargo_resolution_not_performed");
      if(declared.length){gaps.add("license_metadata");gaps.add("package_source_or_integrity");}
      for(const component of declared){
        if(components.length>=4096)throw Error("Aggregate dependency inventory exceeds its original component bound.");
        const referenceKey = shieldArtifactReferenceKey({ ...component, lockPath: file.path }), reference = artifacts.get(referenceKey);
        if (reference) {
          if (!["registry", "crates.io"].includes(component.sourceKind)) throw Error("Only Cargo registry declarations can compare a package artifact.");
          const observed = artifactDigests.get(reference.path), status = observed.sha256 === component.declaredSha256 ? "matched" : "mismatched";
          const inspected = cargoIdentities.get(reference.path), archive = inspected.status === "unsupported" ? inspected : { ...inspected, status: inspected.name === component.name && inspected.version === component.version ? "matched" : "mismatched" };
          const license = archive.license?.status === "declared" ? npmLicenseDeclaration(archive.license.expression, policy.allowedLicenses) : null;
          const licensePolicy = status === "matched" && archive.status === "matched" && license ? !policy.allowedLicenses.length ? "unconfigured" : license.allowed ? "permitted" : "disallowed" : "unassessed";
          component.artifact = { path: observed.path, sha256: observed.sha256, size: observed.size, algorithm: "sha256", expectedSha256: component.declaredSha256, status, archive, licensePolicy };
          if (licensePolicy === "unconfigured") gaps.add("license_policy");
          if (licensePolicy === "permitted" && license.choice) gaps.add("license_choice_not_selected");
          if (licensePolicy === "disallowed") add({ ruleId: "license.disallowed", dimension: "licenses", severity: "high", path: file.path, line: null, fingerprint: sha(["license.disallowed", "Cargo", file.path, file.sha256, component.name, component.version, component.sourceSha256, observed.path, observed.sha256, archive.manifestSha256, license.expression].join("\0")) });
          if (archive.status !== "matched") gaps.add("cargo_archive_identity_not_verified");
          if (archive.status === "mismatched") add({ ruleId: "artifact.identity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(["artifact.identity-mismatch", "Cargo", file.path, file.sha256, component.name, component.version, component.sourceSha256, observed.path, observed.sha256, archive.manifestSha256].join("\0")) });
          consumedArtifacts.add(referenceKey);
          if (status === "mismatched") {
            gaps.add("package_artifact_not_verified");
            add({ ruleId: "artifact.integrity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(`artifact.integrity-mismatch\0Cargo\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}\0${component.sourceSha256}\0${observed.path}\0${observed.sha256}`) });
          }
        } else gaps.add("package_artifact_not_verified");
        components.push({...component,lockPath:file.path});
        const known=component.sourceKind==="crates.io"?advisoryByIdentity.get(advisoryIdentityKey(cratesIoIdentity(component.name,component.version))):undefined;
        if(!known)gaps.add("advisory_package_coverage");
        if(known?.advisories.some(a=>a.severity==="unknown"))gaps.add("advisory_severity_unassessed");
        for(const a of known?.advisories??[])add({ruleId:a.id,dimension:"vulnerabilities",severity:a.severity,path:file.path,line:null,fingerprint:sha(`${a.id}\0Cargo\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}\0${component.sourceSha256}`)});
      }
    }
    if (isPinnedRequirementsPath(file.path) && requested.includes("sbom")) {
      let declared;
      try { declared = parsePinnedRequirements(text); } catch { gaps.add("unsupported_python_requirements"); continue; }
      dependencyManifests++; gaps.add("python_environment_not_resolved");
      if (declared.length) { gaps.add("license_metadata"); gaps.add("package_source_or_integrity"); }
      for (const component of declared) {
        if (components.length >= 4096) throw Error("Aggregate dependency inventory exceeds its original component bound.");
        if (component.extras) gaps.add("python_extras_not_resolved");
        if (component.marker) gaps.add("python_markers_not_evaluated");
        const referenceKey = shieldArtifactReferenceKey({ ...component, requirementsPath: file.path }), reference = artifacts.get(referenceKey);
        if (reference) {
          const observed = artifactDigests.get(reference.path), acceptedSha256 = [...component.declaredSha256];
          const status = !acceptedSha256.length ? "unsupported-integrity" : acceptedSha256.includes(observed.sha256) ? "matched" : "mismatched";
          const inspected = wheelIdentities.get(reference.path), archive = inspected.status === "unsupported" ? inspected : { ...inspected, status: inspected.name === component.name && pypiVersionKey(inspected.version) === pypiVersionKey(component.version) ? "matched" : "mismatched" };
          const declaration = archive.license?.status === "declared" ? npmLicenseDeclaration(archive.license.expression, policy.allowedLicenses) : null;
          const licensePolicy = status === "matched" && archive.status === "matched" && archive.record.status === "verified" && declaration ? !policy.allowedLicenses.length ? "unconfigured" : declaration.allowed ? "permitted" : "disallowed" : "unassessed";
          component.artifact = { path: observed.path, sha256: observed.sha256, size: observed.size, algorithm: "sha256", acceptedSha256, status, archive, licensePolicy };
          if (licensePolicy === "unconfigured") gaps.add("license_policy");
          if (licensePolicy === "permitted" && declaration.choice) gaps.add("license_choice_not_selected");
          if (licensePolicy === "disallowed") add({ ruleId: "license.disallowed", dimension: "licenses", severity: "high", path: file.path, line: null, fingerprint: sha(["license.archive-disallowed", "PyPI", file.path, file.sha256, component.name, component.version, observed.path, observed.sha256, archive.manifestSha256, archive.record.sha256, declaration.expression].join("\0")) });
          if (archive.status !== "matched") gaps.add("python_wheel_identity_not_verified");
          if (archive.record?.status !== "verified") gaps.add("python_wheel_record_not_verified");
          if (archive.record?.status === "mismatched") add({ ruleId: "artifact.record-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(["artifact.record-mismatch", "PyPI", file.path, file.sha256, component.name, component.version, observed.path, observed.sha256, archive.record.sha256].join("\0")) });
          if (archive.status === "mismatched") add({ ruleId: "artifact.identity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(["artifact.identity-mismatch", "PyPI", file.path, file.sha256, component.name, component.version, observed.path, observed.sha256, archive.manifestSha256].join("\0")) });
          consumedArtifacts.add(referenceKey);
          if (status !== "matched") gaps.add("package_artifact_not_verified");
          if (status === "mismatched") add({ ruleId: "artifact.integrity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(`artifact.integrity-mismatch\0PyPI\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}\0${observed.path}\0${observed.sha256}`) });
        } else gaps.add("package_artifact_not_verified");
        components.push({ ...component, requirementsPath: file.path });
        const known = advisoryByIdentity.get(advisoryIdentityKey(component));
        if (!known) gaps.add("advisory_package_coverage");
        if (known?.advisories.some(a => a.severity === "unknown")) gaps.add("advisory_severity_unassessed");
        for (const a of known?.advisories ?? []) add({ ruleId: a.id, dimension: "vulnerabilities", severity: a.severity, path: file.path, line: null, fingerprint: sha(`${a.id}\0PyPI\0${file.path}\0${file.sha256}\0${component.name}\0${component.version}`) });
      }
    }
    if (file.path.split("/").at(-1) === "package-lock.json" && requested.includes("sbom")) {
      let lock;
      try { lock = json(bytes); } catch { gaps.add("invalid_npm_lock"); continue; }
      if (!object(lock) || ![2, 3].includes(lock.lockfileVersion) || !object(lock.packages) || Object.keys(lock.packages).length > 4096) { gaps.add("unsupported_npm_lock"); continue; }
      dependencyManifests++;
      const links = new Map(), targets = new Set(), workspaceCache = new Map();
      for (const [location, p] of Object.entries(lock.packages)) if (object(p) && p.link === true) {
        try {
          const installedAs = npmLocationName(location);
          if (!installedAs) throw Error("Unsupported workspace install location.");
          const target = workspaceLink(lock.packages, p, workspaceCache);
          links.set(location, { ...target, installedAs }); targets.add(target.workspace.path);
        } catch { gaps.add("unsupported_npm_package"); }
      }
      for (const [location, raw] of Object.entries(lock.packages)) {
        if (!location) continue;
        if (targets.has(location)) continue;
        const linked = links.get(location), p = linked?.metadata ?? raw;
        let installedAs;
        try { installedAs = npmLocationName(location); } catch { gaps.add("unsupported_npm_package"); continue; }
        if (!installedAs || !object(p) || (raw.link === true && !linked) || (p.link !== undefined && p.link !== false) || !npmVersion(p.version)) { gaps.add("unsupported_npm_package"); continue; }
        const name = p.name ?? installedAs;
        if (!npmName(name)) { gaps.add("unsupported_npm_package"); continue; }
        const license = npmLicenseDeclaration(p.license, policy.allowedLicenses);
        const component = { ecosystem: "npm", name, installedAs, version: p.version, location, lockPath: file.path, license: license?.expression ?? null, integritySha256: !linked && typeof p.integrity === "string" ? sha(p.integrity) : null, ...(linked ? { workspace: linked.workspace } : {}) };
        const reference = artifacts.get(artifactKey(file.path, location));
        if (reference) {
          if (linked) throw Error("Workspace links cannot attest a package artifact.");
          consumedArtifacts.add(artifactKey(file.path, location));
          const observed = artifactDigests.get(reference.path), expectedSha512 = npmArtifactSha512(p.integrity);
          const status = expectedSha512 === null ? "unsupported-integrity" : expectedSha512 === observed.observedSha512 ? "matched" : "mismatched";
          const inspected = archiveIdentities.get(reference.path);
          const archive = inspected.status === "unsupported" ? inspected : { ...inspected, status: inspected.name === name && inspected.version === p.version ? "matched" : "mismatched" };
          const declaration = archive.license?.status === "declared" ? npmLicenseDeclaration(archive.license.expression, policy.allowedLicenses) : null;
          const licensePolicy = status === "matched" && archive.status === "matched" && declaration ? !policy.allowedLicenses.length ? "unconfigured" : declaration.allowed ? "permitted" : "disallowed" : "unassessed";
          component.artifact = { ...observed, algorithm: "sha512", expectedSha512, status, archive, licensePolicy };
          if (!declaration || !spdxLicenseMembership(declaration.expression).listed) gaps.add("license_metadata");
          if (licensePolicy === "unconfigured") gaps.add("license_policy");
          if (licensePolicy === "permitted" && declaration.choice) gaps.add("license_choice_not_selected");
          if (licensePolicy === "disallowed") add({ ruleId: "license.disallowed", dimension: "licenses", severity: "high", path: file.path, line: null, fingerprint: sha(["license.archive-disallowed", "npm", file.path, file.sha256, location, observed.path, observed.sha256, archive.manifestSha256, declaration.expression].join("\0")) });
          if (archive.status !== "matched") gaps.add("npm_archive_identity_not_verified");
          if (archive.status === "mismatched") add({ ruleId: "artifact.identity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(["artifact.identity-mismatch", file.path, file.sha256, location, observed.path, observed.sha256, archive.manifestSha256].join("\0")) });
          if (status !== "matched") gaps.add("package_artifact_not_verified");
          if (status === "mismatched") add({ ruleId: "artifact.integrity-mismatch", dimension: "provenance", severity: "high", path: file.path, line: null, fingerprint: sha(`artifact.integrity-mismatch\0${file.path}\0${file.sha256}\0${location}\0${observed.path}\0${observed.sha256}`) });
        } else gaps.add("package_artifact_not_verified");
        if (components.length >= 4096) throw Error("Aggregate dependency inventory exceeds its original component bound.");
        components.push(component);
        const known = advisoryByIdentity.get(advisoryIdentityKey({ ecosystem: "npm", name, version: p.version }));
        if (!known) gaps.add("advisory_package_coverage");
        if (known?.advisories.some(advisory => advisory.severity === "unknown")) gaps.add("advisory_severity_unassessed");
        for (const a of known?.advisories ?? []) add({ ruleId: a.id, dimension: "vulnerabilities", severity: a.severity, path: file.path, line: null, fingerprint: sha(`${a.id}\0${file.path}\0${file.sha256}\0${location}\0${p.version}`) });
        if (!component.license) gaps.add("license_metadata");
        else if (!policy.allowedLicenses.length) gaps.add("license_policy");
        else if (!license.allowed) add({ ruleId: "license.disallowed", dimension: "licenses", severity: "high", path: file.path, line: null, fingerprint: sha(`license\0${file.path}\0${file.sha256}\0${location}\0${component.license}`) });
        if (license?.choice && license.allowed) gaps.add("license_choice_not_selected");
        if (component.license && !spdxLicenseMembership(component.license).listed) gaps.add("license_metadata");
        let registry = false;
        try { const u = new URL(p.resolved); registry = u.protocol === "https:" && u.hostname === "registry.npmjs.org" && !u.username && !u.password && !u.search && !u.hash && npmArtifactSha512(p.integrity) !== null; } catch {}
        if (linked) gaps.add("workspace_source_unverified");
        if (linked || !registry) gaps.add("package_source_or_integrity");
      }
    }
  }
  if (consumedArtifacts.size !== artifacts.size) throw Error("A reviewed artifact reference did not resolve to an exact supported component.");
  if (requested.includes("history")) gaps.add(request.files.some(file=>file.source?.kind==="git-history")?"git_history_partially_scanned":"git_history_not_scanned");
  if (requested.includes("permissions")) gaps.add("source_permissions_not_witnessed");
  if (requested.includes("provenance")) gaps.add("publisher_provenance_not_verified");
  if (requested.includes("isolation")) gaps.add("host_isolation_requires_attestation");
  if (requested.includes("vulnerabilities") && !request.advisory) gaps.add("advisory_feed_missing");
  if (requested.includes("sbom") && dependencyManifests === 0) gaps.add("dependency_manifest_missing");
  const matrix = requested.map(dimension => ({ dimension, status: "incomplete", rules: policy.selected.filter(id => rules[id].dimension === dimension), findings: findings.filter(f => f.dimension === dimension).length }));
  const cycloneDx = { bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
    metadata: { tools: { components: [{ type: "application", name: "switchyard-baseline-scanner", version: "1" }] }, properties: [
      { name: "switchyard:scope", value: request.scope }, { name: "switchyard:repository-scope", value: "unverified" },
      { name: "switchyard:dependency-graph", value: "not-collected" }, { name: "switchyard:publisher-provenance", value: "not-verified" },
      ...inventory.filter(f=>f.path.split("/").at(-1)==="package-lock.json"||isPinnedRequirementsPath(f.path)||isCargoLockPath(f.path)).map(f=>({name:"switchyard:dependency-manifest:"+f.path,value:"sha256:"+f.sha256}))
    ] },
    components: components.map(shieldCycloneDxComponent), compositions: [{ aggregate: "unknown" }]
  };
  const report = { schema: "switchyard-shield-findings/v1", version: 1, engine: shieldEngineVersion, action: request.action, scope: request.scope, requestSha256: sha(JSON.stringify(request)), scanner: request.scanner, advisory: request.advisory, outcome: findings.length ? "failed" : "incomplete", completeness: "incomplete", coverage: matrix, gaps: [...gaps].sort(), inventory, findings, sbom: { schema: "switchyard-lock-inventory/v2", components }, cycloneDx: requested.includes("sbom") ? cycloneDx : null };
  if (Buffer.byteLength(JSON.stringify(report)) > 480 * 1024) throw Error("Scanner report exceeds the retained output bound.");
  return report;
}

export function createShieldFileReader(root) {
  const base = resolve(root);
  return async (path, maximum) => {
    scannerPath(path); if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 2 * 1024 * 1024) throw Error("Invalid scanner read bound.");
    const target = resolve(base, path), rel = relative(base, target); if (!rel || rel.startsWith("../") || isAbsolute(rel)) throw Error("Scanner input escaped its root.");
    let parent = base;
    for (const part of relative(base, dirname(target)).split(/[\\/]/).filter(Boolean)) { parent = resolve(parent, part); if (!(await lstat(parent)).isDirectory() || (await lstat(parent)).isSymbolicLink()) throw Error("Linked scanner input directory."); }
    if (await realpath(base) !== base || await realpath(target) !== target) throw Error("Linked scanner input.");
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true }); if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum)) throw Error("Scanner input is not a bounded unlinked file.");
      const bytes = Buffer.alloc(Number(before.size) + 1); let offset = 0;
      while (offset < bytes.length) { const r = await handle.read(bytes, offset, bytes.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead; }
      const after = await handle.stat({ bigint: true });
      if (offset !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.ino !== after.ino) throw Error("Scanner input changed while reading.");
      return bytes.subarray(0, offset);
    } finally { await handle.close(); }
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error("Select one reviewed scanner request.");
    const readInput = createShieldFileReader(await realpath(process.cwd()));
    const request = json(await readInput(scannerPath(process.argv[2]), 128 * 1024));
    process.stdout.write(JSON.stringify(await scanShieldInputs(request, { readInput })));
    // A report is a successful observation even when findings fail its gate.
    // The trusted host, never a zero exit alone, decides the gate outcome.
  } catch { process.stderr.write("The pinned Shield scanner could not verify its exact inputs.\n"); process.exitCode = 78; }
}
