import {defineConfig} from '@trigger.dev/sdk';
// Manual-setup scaffold only: no real project is selected and no env file is loaded.
export default defineConfig({
  project:process.env.DWELLHUNT_TRIGGER_PROJECT_REF||'UNCONFIGURED_LOCAL_ONLY',
  runtime:'node-24',dirs:['./trigger'],maxDuration:30,
  retries:{enabledInDev:false,default:{maxAttempts:1,minTimeoutInMs:1000,maxTimeoutInMs:30000,factor:2,randomize:false}}
});
