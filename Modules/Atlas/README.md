# Atlas:  CostMatrix creation and management system
Atlas provides a simple interface for generating CostMatrix objects and an automated caching, update, and retrieval system for use with PathFinder.
##### Simple Interface
Atlas is primarily interacted with through a static `.getCosts()` method call. Simply passing a room's name will automatically return a CostMatrix object suitable for use with PathFinder.search().  Simple optional arguments allow for additional control, like treating all creep positions as unwalkable.
##### Automated Management
Because CostMatrix data is often relevant over hundreds, if not thousands of ticks, Atlas links matrix instances to room names and caches a serialized version to a module level `Map()` object for later use.  The storage and retrieval process happens automatically every time `.getCost()` is performed and requires no configuration on your part.


## Behavior - CostMatrix caching, retrieval, and performance
Atlas is primarily interacted with through its `.getCosts()` method and its behavior is customized through an optional `opts` object.  Every call to `.getCosts()` invokes an automated CostMatrix caching system that prioritizes cached instances over creating new objects.

#### Caching
A new CostMatrix instance created by Atlas represents the static, _base_ state of a room and is used for basic PathFinding, and as a template for custom position cost modifications.  Once initial structure costs (primarily roads and obstacles) have been set, the matrix is serialized and stored in a module level `Map` object, `PACKED_COSTS`.

If visibility is not available, a blank CostMatrix is returned and is not stored in for long term caching in `PACKED_COSTS`.

#### Retrieval
CostMatrix instances are retrieved and deserialized on a per-tick basis.  Regardless of why a CostMatrix is requested, its base state is always first stored in a module level object, `COSTS_ROOM`.  The instance found in `COSTS_ROOM` acts as a template for modification requests made the same tick.  For example, CostMatrix instances that reflect creep positions (which get their own temporary cache, `COSTS_CREEPS`), are modified clones of instance objects found in `COSTS_ROOM`.

The process of deserializing and storing CostMatrix instances for a single tick allows modifications to be made without changing the base state of the original, serialized matrix stored in `PACKED_COSTS`.  The lookup process always proceeds as follows:
  1. Check for base matrix in `PACKED_COSTS`
  2. If not found, and visibility is available, generate and cache a new CostMatrix instance
  3. If not found, and visibility *is not* available, generate a blank matrix and store directly in `COSTS_ROOM`
  4. Check for deserialized version in `COSTS_ROOM`:
  5. If not found, deserialize from `PACKED_COSTS` and store result

`COSTS_ROOM` and `COSTS_CREEP` are automatically emptied when their last recorded reset tick does not equal the current tick.

#### Performance
Using [Packed.js](../Packed/) will provide extremely fast serialization and deserialization (up to 10x and 17x faster over native methods), resulting in insignificant per-tick CPU costs.  The fallback versions, while not slow, have a small, but noticeable impact.  Atlas is dependency free by default; for improved performance, simply include a copy of `Packed.js` in your screeps project files and it will automatically be imported.


## Usage and Examples
##### Setup
Assume room visibility and the following arbitrarily assigned values for all examples.
```node
const start = new RoomPosition(25, 25, 'E0S1')
const goal = {range: 1, pos: new RoomPosition(20, 20, 'E0S4')}
```

---
##### PathFinder roomCallback: all structures in a room
```node
const result = PathFinder.search(start, goal, {
  roomCallback: roomName => Atlas.getCosts(roomName)
});

```

---
##### PathFinder roomCallback: all structures AND creeps in a room
```node
const result = PathFinder.search(start, goal, {
  roomCallback: roomName => Atlas.getCosts(roomName, {trackCreeps: true})
});
```

---
##### Generate a fresh CostMatrix for all searched rooms
```node
const result = PathFinder.search(start, goal, {
  roomCallback: roomName => Atlas.getCosts(roomName, {opts.refreshMatrix: true})
});
```

---
##### Explicitly refresh a room's cached CostMatrix
```node
//Useful when building structures in a room
Atlas.refresh(start.roomName);
```

---
##### Assign high cost to 3x3 area around all hostile creeps
```node
const result = PathFinder.search(start, goal, {
  roomCallback: roomName => {
      const room = Game.rooms[roomName];
      if (!room) return;

      return Atlas.getCosts(roomName, {
        trackCreeps: true,
        refreshMatrix: true,
        addArea: [{targets: room.find(FIND_HOSTILE_CREEPS), cost: 225, area: 3}]
      });
  }
});
```

## API reference

### `getCosts(roomName, [opts])`
Retrieves CostMatrix instance associated with roomName; if no instance found, a new object is created and cached for future use

##### Arguments
| Name       | Type   |                 Description                  |
|:-----------|:-------|:--------------------------------------------:|
| `roomName` | string | roomName associated with CostMatrix instance |

##### opts
| Property            | Type            |                                  Description                                   |
|:--------------------|:----------------|:------------------------------------------------------------------------------:|
| `trackCreeps`       | [boolean=false] |                  If true, treat creep positions as unwalkable                  |
| `refreshMatrix`     | [boolean=false] |                     If true, a new CostMatrix is generated                     |
| `addArea`           | [Object[]]      |     Used to set the area around objects/positions to a certain cost value      |
| `addArea[].objects` | Object[]        | objects/positions that serve as the center reference point for area generation |
| `addArea[].size`    | number          |        The NxN size of the area to reflect around each reference object        |
| `addArea[].cost`    | number          |          The cost each position in the generated area will be set to           |
| `addArea[].replace` | [boolean=true]  |       Provide false to respect existing costs in matrix where value > 0        |

##### Return Value
| Type                  |     Description     |
|:----------------------|:-------------------:|
| PathFinder.CostMatrix | CostMatrix instance |

---
### `refresh(roomName, [opts])`
Accepts same arguments as getCosts(); updates and caches new CostMatrix, but does not return result

---
### `getWalkableArea(reference, size, [allowExits=true])`
Generates [x, y] pairs of all walkable tiles in a size x size square area around a reference object.  Any reference position (within normal room bounds) can be safely used with any desired area.  Tiles that extend past room boundaries excluded from return value;

##### Arguments
| Name         | Type                    |                               Description                                |
|:-------------|:------------------------|:------------------------------------------------------------------------:|
| `reference`  | RoomObject\RoomPosition |       Used as a central reference position to generate area around       |
| `size`       | number                  |                          The desired area size                           |
| `allowExits` | [boolean=true]          | If true, x,y coordinates of exit tiles will be included in return result |

##### Return Value
| Type    |                   Description                    |
|:--------|:------------------------------------------------:|
| boolean | true if wall at x,y position in room, else false |

---
### `isWallAt(x, y, roomName)`
Determines if wall at x,y position using Room.Terrain interface.  Visibility not required.

##### Arguments
| Name       | Type   |     Description     |
|:-----------|:-------|:-------------------:|
| `x`        | number |     x position      |
| `y`        | number |     y position      |
| `roomName` | string | name of target room |

##### Return Value
| Type    |                     Description                     |
|:--------|:---------------------------------------------------:|
| boolean | true if wall is at x,y position in room, else false |









