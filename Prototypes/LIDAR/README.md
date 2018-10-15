## LIDAR - Microoptimized RoomPosition Methods
LIDAR offers faster, lower overhead alaternatives to the following RoomPosition methods:
 * [isEqualTo](https://docs.screeps.com/api/#RoomPosition.isEqualTo)
 * [isNearTo](https://docs.screeps.com/api/#RoomPosition.isNearTo)
 * [inRangeTo](https://docs.screeps.com/api/#RoomPosition.inRangeTo)
 * [getRangeTo](https://docs.screeps.com/api/#RoomPosition.getRangeTo)
 * [getDirectionTo](https://docs.screeps.com/api/#RoomPosition.getDirectionTo)

### Usage
All replacements take the same input, and return the same output provided by their counterparts.  If you chose to overload the original method names, no code changes (beyond the `require()` call) are needed your part.

`LidarOverloaded.js` can be used to overload the original methods, `LidarExtensions` provides the same method bodies provided by `LidarOverloaded`, except the method names aren't overloaded.  In either case, simple `require()` the desired file somewhere in your project and the effect will take place once once you resubmit your code.

If you want to replace all calls to the original methods with the new versions (including calls made by other API methods), use `LidarOverloaded`.  All replacements were tested hundreds of thousands of times on the live server to ensure that return values between the original and updated versions matched exactly for the same input.  I use the overloaded version in my own code and have experience no problems.

If you don't want to overload the original methods names, you can use `LidarExtensions` instead; functionality is exactly the same, except the names have been changed to the following:

```node
const pos1 = new RoomPosition(25, 25, 'W0N0');
const pos2 = new RoomPosition(0, 0, 'W0N0');

pos1.isEqualTo(pos2) === pos1.isSameAs(pos2);

pos1.isNearTo(pos2) === pos1.isCloseTo(pos2);

pos1.inRangeTo(pos2, 3) === pos1.inDistanceTo(pos2);

pos1.getRangeTo(pos2) === pos1.getDistanceTo(pos2);

pos1.getDirectionTo(pos2) === pos1.getHeadingTo(pos2);

```


### Benefits
Many of these methods are used by other methods.  Even if you don't use them in your code, other methods are calling them.  Depending on your Creep count, these methods, collectively, can easily be called almost a thousand times in a single tick   While the CPU cost is still low, they have some overhead associated with them due to a utility function, `fetchXYArguments()` the game uses internally.  Under normal circumstances, it would be a great helper function that reduces verbosity.  In screeps, however, it adds overhead and slightly increases CPU usage.

Keep in mind, these are micro-optimizations and improvement may only be noticeable for those with hundreds of creeps, or for those who are severely CPU restricted in some other way.

### Limitations
For those using `LidarOverloaded`, these methods reflect the originals at a previous point in time.  While the original API methods have remain unchanged and stable for a long period of time, they are still part of a public API subject to change.

While any changes to the API shouldn't affect the return values, if it does, here's the warning.  Safety first and all that.
