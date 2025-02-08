# Token Bridge UI

## Rationale

Interacting with smart contracts can be cumbersome as you need to past the abis and contract addresses and have no validation of the inputs you are using.
Thats why we created a Dapp to improve the user experience when using the token bridge.

## Developers

This UI uses plain HTML and js for facility of use. To use is locally serve the page using
`python3 -m http.server 9000`
And then you can interact with the dapp on your browser at `localhost:9000`
The UI detects if the url includes `/testnet.html` in order to avoid someone sending incorrectly funds from a live network. If you want to try it locally add `/testnet.html` to the url to use the Hathor Testnet and Sepolia.
