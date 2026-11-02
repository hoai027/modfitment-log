# Mod Fitment Log

A local app for tracking car mods and checking wheel and tire fitment before you buy. It has no accounts and stores everything on your own computer.

- **Mods:** log each part as planned, installed or removed, and record how you know it fits: unverified, community report, manufacturer spec or confirmed on your car.
- **Wheels and tires:** enter a known-good baseline, then compare other setups. See how far the lips move, the change in overall diameter, the real speed at an indicated 60 mph, and warnings based on the room you measured.
- **Backups:** export everything to a JSON file. Importing adds the backup's cars to your log and doesn't overwrite anything.

- **Factory specs (optional):** if `src/honda-stock.json` is present, a Honda's wheels and tires tab lists published sizes for that year. This repo doesn't include that file, so the app says no specs are on file. Any specs can be wrong or incomplete, so check them on your car.

## Run it

You need [Node.js](https://nodejs.org) 22.13 or newer. There's nothing else to install.

```sh
npm start
```

Then open <http://127.0.0.1:3000>. Your data is saved in `data/modlog.db`, which is not committed to git.

## Test it

```sh
npm test
```

## Use it on your phone

By default, only your computer can reach the app. To open it to your local network, set a password:

```sh
HOST=0.0.0.0 MODLOG_PASSWORD='choose-a-password' npm start
```

Then visit `http://<your-computer-ip>:3000` on your phone and enter that password with any username. The connection is not encrypted, so only do this on a network you trust. Some networks, such as campus Wi-Fi, block devices from reaching each other.

## Fitment limits

Results are geometry only:

- **Outer lip from hub:** wheel width / 2 - (offset - spacer)
- **Inner lip from hub:** wheel width / 2 + (offset - spacer)
- **Overall diameter:** rim diameter + 2 x tire width x aspect ratio

They leave out camber, suspension travel, ride height, tire bulge and brake clearance. Factory specs are for reference and never feed these results, so a result is only as good as the numbers you enter. Always test-fit before relying on it.

## License

MIT. This project is not affiliated with or endorsed by Honda.
