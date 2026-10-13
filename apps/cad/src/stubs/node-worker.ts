// Browser-build stand-in for the kernel repo's Node worker client. `Session.open` and `openSaved` import it
// lazily for Node use; the browser app builds its own Session with the browser transport and never calls them.
export function createWorkerKernel(): never {
  throw new Error('the Node worker kernel is not available in the browser build');
}
