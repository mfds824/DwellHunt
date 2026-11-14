import {defineConfig} from '@trigger.dev/sdk';
export default defineConfig({project:process.env.TRIGGER_PROJECT_REF||'proj_tiihuqzqlbwcbwjibgyu',runtime:'node',dirs:['./trigger-listings'],maxDuration:120,
 retries:{enabledInDev:false,default:{maxAttempts:3,minTimeoutInMs:5000,maxTimeoutInMs:30000}}});
