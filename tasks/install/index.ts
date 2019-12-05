import * as path from 'path';
import * as os from 'os';
import * as request from 'request-promise';
import * as task from "vsts-task-lib/task";
import * as tool from 'vsts-task-tool-lib/tool';
import * as uuidv4 from 'uuid/v4';

const FLUTTER_TOOL_NAME: string = 'Flutter';
const FLUTTER_EXE_RELATIVEPATH = 'flutter/bin';
const FLUTTER_TOOL_PATH_ENV_VAR: string = 'FlutterToolPath';

async function main(): Promise<void> {
	// 1. Getting current platform identifier
	let arch = findArchitecture();
	const releaseData = await getReleaseData(arch);
	const _baseUrl = releaseData['base_url'];
	// 2. Building version spec
	let releaseInfo = null;
	let channel = task.getInput('channel', true);
	let version = task.getInput('version', true);

	if (version === 'latest')
		releaseInfo = await findLatestRelease(releaseData, channel);
	else
		releaseInfo = await findVersionRelease(releaseData, channel, version);
	let urlRelative = releaseInfo.archive;
	//3. Check if already available
	task.debug(`Trying to get (${FLUTTER_TOOL_NAME},${releaseInfo.version}, ${arch}) tool from local cache`);
	let toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, releaseInfo.version, arch);

	if (!toolPath) {
		// 4.1. Downloading SDK
		await downloadAndCacheSdk(`${_baseUrl}/${urlRelative}`, releaseInfo.version, channel, arch);

		// 4.2. Verifying that tool is now available
		task.debug(`Trying again to get (${FLUTTER_TOOL_NAME},${releaseInfo.version}, ${arch}) tool from local cache`);
		toolPath = tool.findLocalTool(FLUTTER_TOOL_NAME, releaseInfo.version, arch);
	}

	// 5. Creating the environment variable
	let fullFlutterPath: string = path.join(toolPath, FLUTTER_EXE_RELATIVEPATH);
	task.debug(`Set ${FLUTTER_TOOL_PATH_ENV_VAR} with '${fullFlutterPath}'`);
	task.setVariable(FLUTTER_TOOL_PATH_ENV_VAR, fullFlutterPath);
	task.setResult(task.TaskResult.Succeeded, "Installed");
}

function findArchitecture() {
	if (os.platform() === 'darwin')
		return "macos";
	else if (os.platform() === 'linux')
		return "linux";
	return "windows";
}

async function downloadAndCacheSdk(downloadUrl: string, versionSpec: string, channel: string, arch: string): Promise<void> {
	// 1. Download SDK archive
	task.debug(`Starting download archive from '${downloadUrl}'`);
	var bundleZip = await tool.downloadTool(downloadUrl);
	task.debug(`Succeeded to download '${bundleZip}' archive from '${downloadUrl}'`);

	// 2. Extracting SDK bundle
	var bundleDir = '';
	if(downloadUrl.endsWith('.zip')) {
		task.debug(`Extracting '${downloadUrl}' archive as zip`);
		bundleDir = await tool.extractZip(bundleZip);
	}
	else {
		task.debug(`Extracting '${downloadUrl}' archive as tar.xz`);
		bundleDir = await extractTarXZ(bundleZip);
	}
	task.debug(`Extracted to '${bundleDir}' '${downloadUrl}' archive`);
	
	// 3. Adding SDK bundle to cache
	task.debug(`Adding '${bundleDir}' to cache (${FLUTTER_TOOL_NAME},${versionSpec}, ${arch})`);
	await tool.cacheDir(bundleDir, FLUTTER_TOOL_NAME, versionSpec, arch);
}

async function getReleaseData(arch: string): Promise<any> {
	var releasesUrl = `https://storage.googleapis.com/flutter_infra/releases/releases_${arch}.json`;
	task.debug(`Finding latest version from '${releasesUrl}'`);
	let response = await request.get(releasesUrl);
	return JSON.parse(response);
}

function findLatestRelease(releaseData: any, channel: string): string {
	var currentHash = releaseData.current_release[channel];
	task.debug(`Last version hash '${currentHash}'`);
	var current = releaseData.releases.find((item) => item.hash === currentHash);
	return current;
}

function findVersionRelease(releaseData: any, channel: string, version: string): string {
	task.debug(`Requested channel and version '${channel} ${version}'`);
	var release = releaseData.releases.find((item) => item.version === version && item.channel === channel);

	if (!release)
		task.debug(`The requested version of specified channel was not found`);

	return release;
}

async function extractTarXZ(file: string, destination?: string): Promise<string> {

    // mkdir -p node/4.7.0/x64
    // tar xJf ./node/4.7.0/x64 -f node-v4.7.0-darwin-x64.tar.gz --strip-components 1
    let dest = _createExtractFolder(destination);

    let tr = task.tool('tar');
    tr.arg(['-xJC', dest, '-f', file]);

    await tr.exec();
    return dest;
}

function _createExtractFolder(dest?: string): string {
    if (!dest) {
        // create a temp dir
        dest = path.join(task.getVariable('Agent.TempDirectory'), uuidv4());
    }

    task.mkdirP(dest);
    
    return dest;
}

main().catch(error => {
	task.setResult(task.TaskResult.Failed, error);
});