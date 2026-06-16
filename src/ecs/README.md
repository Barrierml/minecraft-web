# ECS Runtime

This directory owns the bitECS-backed entity runtime for drops, mobs, and animals.

Current structure:

```text
components.js      plain component stores plus sparse mesh refs
world.js           ECS world singleton and shared query helpers
factories.js       entity creation/removal and THREE mesh construction
snapshot.js        save/network serialization and hydration
systems/
```

The project uses `bitecs@0.4.0/dist/core/index.min.mjs`, so systems use
`addComponent(world, eid, Component)` and `query(world, [Component...])`.
