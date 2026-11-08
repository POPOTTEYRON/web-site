import { config } from './config.js';
import { createApp } from './app.js';

createApp().listen(config.PORT, () => {
  console.log(`Ti Mango — http://localhost:${config.PORT} (${config.NODE_ENV})`);
});
