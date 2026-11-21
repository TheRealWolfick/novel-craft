// electron-builder afterPack hook: macOS builds are not signed with a paid Apple certificate, but Apple Silicon only
// runs apps that carry some signature, and packing (renaming, Info.plist) breaks the one Electron ships with. So the
// finished .app is signed ad hoc ("-"). Users still confirm it once in System Settings → Privacy & Security.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function (context) {
    if (context.electronPlatformName !== "darwin") return;
    const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
    execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
