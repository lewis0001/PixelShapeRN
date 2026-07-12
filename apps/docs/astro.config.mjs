import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "BOTFORGE Docs",
      description: "Documentation for BOTFORGE, an open modular robotics platform.",
      sidebar: [
        {
          label: "Robots",
          autogenerate: { directory: "robots" },
        },
      ],
    }),
  ],
});
