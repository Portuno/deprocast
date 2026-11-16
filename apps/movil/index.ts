import { registerRootComponent } from 'expo';
// La tarea de fondo del recorrido tiene que estar definida apenas arranca (Android la despierta con la app cerrada).
import './src/recorrido';
// Lo mismo la de fondo (Mobile 1.3): cada ~15 minutos, los pasos, el uso del teléfono y los avisos.
import './src/fondo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
