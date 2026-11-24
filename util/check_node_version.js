/**
 * Stops the process with a clear message when Node is older than the minimum.
 * Imported first by server.js, so it runs before anything else is loaded.
 *
 * @author: tgibbons via Claude
 */
const MINIMUM_NODE_MAJOR = 20;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MINIMUM_NODE_MAJOR) {
    console.error(`Node ${MINIMUM_NODE_MAJOR} or later is required; you are running ${process.versions.node}.`);
    process.exit(1);
}
