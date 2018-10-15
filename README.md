# Overview
`screeps-pluggable` is a collection of modules and prototype extensions for your existing code base. Although some systems are designed by default to interoperate, they are loosely coupled and can easily be modified to reduce or eliminate dependencies entirely.

Source code found in this repository often prioritizes performance. My approach to working within the resource limits set by the game world is to make certain assumptions about the context in which functions, methods and modules are used. While this can pose problems in a typical production environment, in Screeps, I often benefited from these assumptions when used responsibly.

Although my approach has worked well personally so far, the purpose of this repository is to provide utility for others, not just myself. I am always looking for improvements and additional insights, so if you find any of these modules useful, but feel that something can be done better, submit a PR or issue ticket and I would be happy to discuss the proposal further.


## Directory
Below you can find lists of actively maintained files.  Each link points to a more detailed description of whats provided in addition the the source files themselves.

### Game Prototypes
  * [Packed](/Prototypes/Packed/):  `CostMatrix` extensions offering fast compression and small memory footprint
  * [LIDAR](/Prototypes/LIDAR/)  :  Micro-optimized, overload safe replacements to commonly used `RoomPosition` methods

