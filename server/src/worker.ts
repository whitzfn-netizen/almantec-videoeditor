import { seedProfiles } from "./presets.js";
import { startWorker } from "./queue.js";
import { startRetention } from "./retention.js";

seedProfiles();
startWorker();
startRetention();
console.log("Procesador de trabajos de AlmanTec Viral Studio en marcha");
