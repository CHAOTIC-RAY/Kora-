import worker from "../../src/worker";

export const onRequest = async (context: any) => {
  const { request, env, waitUntil } = context;
  
  const ctx = {
    waitUntil(promise: Promise<any>) {
      if (typeof waitUntil === "function") {
        waitUntil(promise);
      }
    }
  };

  return worker.fetch(request, env, ctx);
};
