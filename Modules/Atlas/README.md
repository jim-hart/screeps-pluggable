# Atlas:  CostMatrix creation and management system

## Quick Links

* [API and Examples](https://github.com/jim-hart/screeps-pluggable/wiki/Atlas)
* [Overview](#overview)
* [Install Instructions](#installation-and-usage)
* [CostMatrix Management System](#behavior)
  - [Caching](#caching)
  - [Retrieval](#retrieval)
  - [Performance](#performance)


## Overview
Atlas provides a simple interface for generating CostMatrix objects and an automated caching, update, and retrieval system for use with PathFinder.

##### Simple Interface
Atlas is primarily interacted with through a static `.getCosts()` method call. Simply passing a room's name will automatically return a CostMatrix object suitable for use with PathFinder.search().  Simple optional arguments allow for additional control, like treating all creep positions as unwalkable.

##### Automated Management
Because CostMatrix data is often relevant over hundreds, if not thousands of ticks, Atlas links matrix instances to room names and caches a serialized version to a module level `Map()` object for later use.  The storage and retrieval process happens automatically every time `.getCost()` is performed and requires no configuration on your part.


## Installation and Usage
Include a copy of `Atlas.js` in your screeps project folder, or copy and paste its contents into a file directly.  You can use Atlas on a per module basis by placing the following at the top of any file:
```node
const Atlas = require('Atlas');
```

You can find examples and API documentation in the [Atlas API](https://github.com/jim-hart/screeps-pluggable/wiki/Atlas)

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
Atlas uses [Packed.js](../../Prototypes/Packed/) for fast serialization and deserialization; average speeds for each action are:
  * serializing ---> 0.007 CPU
  * deserializing -> 0.006 CPU

Because the global CostMatrix cache is only reset every 500 ticks, Atlas primarily makes deserialization calls.  At peak usage, I've found the cumulative CPU cost for a single tick to be around 0.18 with average usage at < 0.1 CPU.







