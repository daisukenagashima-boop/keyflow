'use strict';
// Ad-hoc code sign after packaging so macOS won't show "damaged" on Gatekeeper.
// This is free and requires no Apple Developer account.
// Users will still see "unidentified developer" but right-click → Open works.
const { execSync } = require('child_process');
const path = require('path');

exports.default = async (context) => {
  // Universal builds pack arm64/x64 separately into temp dirs before merging.
  // Skip the temp builds; sign only the final merged output.
  if (context.appOutDir.includes('-temp')) return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  console.log(`  • ad-hoc signing  ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
};
