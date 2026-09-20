# @capire/xflights-data

This is a pre-built integration package to access master data like Airlines, Airports, and Flights, served by the [xflights](https://github.com/capire/xflights) microservice. For example, it is used in the [xtravels](https://github.com/capire/xtravels) application.


## Setup

Add it to your consuming CAP app:

```sh
npm add @capire/xflights-data
```

<details>
<summary>

   _Using GitHub Packages..._

</summary>

  The samples are published to the [GitHub Packages](https://docs.github.com/packages) registry,
  which requires you to npm login once like that:

  ```sh
  npm login --scope=@capire --registry=https://npm.pkg.github.com
  ```

  As password you're using a Personal Access Token (classic) with `read:packages` scope.
  Read more about it in [Authenticating to GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry#authenticating-to-github-packages).

</details>


## Usage

Then you can import and use the entities in your CDS models like this:

```cds
using { sap.capire.flights.FlightsService.Flights } from '@capire/xflights-data';
// mashup with your own entities ...
```
Find examples for that in the [_xtravels_ application](https://github.com/capire/xtravels/blob/main/db/xflights.cds).


## License

Copyright (c) 2022 SAP SE or an SAP affiliate company. All rights reserved. This file is licensed under the Apache Software License, version 2.0 except as noted otherwise in the [LICENSE](LICENSE) file.
