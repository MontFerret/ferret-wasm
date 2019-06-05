const isNodeJS = !!(
    typeof process !== 'undefined' &&
    process.versions &&
    process.versions.node
);

export default isNodeJS;
