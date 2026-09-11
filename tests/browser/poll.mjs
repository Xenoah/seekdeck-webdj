// Playwright's waitForFunction tests the predicate's return value synchronously.
// A Promise is truthy even when it resolves to false. Await each browser evaluation here.
export async function waitForAsync(page,predicate,arg,options={}){
 const timeout=options.timeout??30000,deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  const result=await page.evaluate(predicate,arg);
  if(result)return result;
  await page.waitForTimeout(50);
 }
 throw new Error(`Browser condition did not become true within ${timeout} ms.`);
}
