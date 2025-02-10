//User
let address = "";
let activeAddresseth2HtrTxns = [];
let eth2HtrTablePage = 1;
let eth2HtrPaginationObj = {};
let activeAddresshtr2EthTxns = [];
let htr2EthTablePage = 1;
let htr2EthPaginationObj = {};
let poolingIntervalId = null;
//Network configuration
let config = null;
let isTestnet = true;
let allowTokensContract = null;
let bridgeContract = null;
let hathorFederationContract = null;
let federationContract = null;
let minTokensAllowed = 1;
let maxTokensAllowed = 100_000;
let maxDailyLimit = 1_000_000;
let currentBlockNumber = null;
// Selected Token To Cross  
let tokenContract = null;
let isSideToken = false;
let sideTokenAddress = null;
let fee = 0;
let feePercentage = 0;
let feePercentageDivider = 10_000;
let rLogin;
let pollingLastBlockIntervalId = 0;
let DateTime = luxon.DateTime;

$(document).ready(function () {
  new ClipboardJS(".copy");
  $('[data-toggle="tooltip"]').tooltip();
  $(".selectpicker").selectpicker();

  isTestnet = window.location.href.includes("testnet");
  if (isTestnet) {
    $("#title").text("Hathor Golf Testnet bridge with Sepolia");
  }
  if (
    !/chrom(e|ium)/.test(navigator.userAgent.toLowerCase()) &&
    navigator.userAgent.indexOf("Firefox") == -1
  ) {
    alert(
      "This site will only work correctly under chrome, chromium or firefox"
    );
  }

  disableInputs(true);
  disableApproveCross({
    approvalDisable: true,
    doNotAskDisabled: true,
    crossDisabled: true,
  });

  $("#logIn").attr("onclick", "onLogInClick()");

  let rpc = {
    1: "https://mainnet.infura.io/v3/8043bb2cf99347b1bfadfb233c5325c0",
  };
  supportedChains = [1];
  if (isTestnet) {
    rpc = {
      11155111: "https://sepolia.infura.io/v3/399500b5679b442eb991fefee1c5bfdc",
    };
    supportedChains = [11155111];
  }
  rLogin = new window.RLogin.default({
    cacheProvider: false,
    providerOptions: {
      walletconnect: {
        package: window.WalletConnectProvider.default,
        options: {
          rpc: rpc,
        },
      },
    },
    supportedChains: supportedChains,
  });

  $("#claimTab").hide();

  $("#claimTokens").click(function () {
    showEvmTxsnTabe();
    location.hash = "";
    location.hash = `#nav-eth-htr-tab`;
  });

  $("#tokenAddress").change(async function (event) {
    cleanAlertSuccess();
    let token = TOKENS.find(
      (element) => element.token == event.currentTarget.value
    );
    if (token) {

      tokenContract = new web3.eth.Contract(ERC20_ABI, token[config.networkId].address);

      const balance = await tokenContract.methods.balanceOf(address).call();

      $(".tokenAddress-label").text(`You own ${balance / Math.pow(10, token[config.networkId].decimals)}`)


      $(".selectedToken").html(token[config.networkId].symbol);
      let html = `<a target="_blank" href="${
        config.crossToNetwork.explorer
      }/address/${token[
        config.crossToNetwork.networkId
      ].address.toLowerCase()}">`;
      html += `\n   <span><img src="${token.icon}" class="token-logo"></span>${
        token[config.crossToNetwork.networkId].symbol
      }`;
      html += `\n </a>`;
      $("#willReceiveToken").html(html);
      $("#willReceive-copy").show();
      $("#willReceive-copy").attr(
        "data-clipboard-text",
        token[config.crossToNetwork.networkId].address
      );
      if ($("#amount").val()) {
        isAmountOk();
        checkAllowance();
      }
    } else {
      $(".selectedToken").html("");
      $("#willReceive").html("");
      $("#willReceive-copy").hide();
    }

    setInfoTab(token[config.networkId].address);
  });

  $("#amount").keyup(function (event) {
    isAmountOk();
    if (event.key === "Enter") {
      checkAllowance();
    }
  });
  $("#amount").focusout(checkAllowance);
  $("#amount").keypress(function (event) {
    if (event.key !== "." && (event.key < "0" || event.key > "9")) {
      return false;
    }
  });
  $("#crossForm").on("submit", function (e) {
    e.preventDefault();
    crossToken();
  });
  $("#approve").on("click", function (e) {
    e.preventDefault();
    approveSpend();
  });

  $("#changeNetwork").on("click", function () {
    showModal(
      "Operation not Available",
      "This operation is unavailable until Celo Donut Fork."
    );
  });
  updateTokenListTab();
  isInstalled();
});

// CLAIMS

async function fillHathorToEvmTxs() {  
  const walletAddress = $("#address").text();

  if (!walletAddress || walletAddress === "0x123456789") {
    return;
  }

  const claims = await getPendingClaims();
  const transactions = await getPendingHathorTxs(claims);

  transactions.forEach(prpsl => 
    {
      const tk = TOKENS.find((token) => 
        token[config.crossToNetwork.networkId].hathorAddr === prpsl.originalTokenAddress || 
        token[config.networkId].address === prpsl.originalTokenAddress ||
        token[config.crossToNetwork.networkId].address === prpsl.originalTokenAddress
      );

      TXN_Storage.addHathorTxn(address, config.crossToNetwork.name, {
        transactionHash: prpsl.transactionHash,
        token: tk[config.networkId].symbol,
        amount: prpsl.value ? prpsl.value / 100 : prpsl.amount / Math.pow(10, tk[config.networkId].decimals),
        sender: prpsl.sender,
        status: prpsl.status,
        action: setStatusAction(prpsl.status, prpsl),
      });
    }
  );

  updateActiveAddressTXNs(walletAddress);
  showActiveAddressTXNs();
}

async function getPendingHathorTxs(claims) {
if (!hathorFederationContract) {
    const prvdr = new Web3(new Web3.providers.HttpProvider('https://arb-sepolia.g.alchemy.com/v2/uZC_k6qzUFbIP5MigPnBCvry-n9M-gOV'));
    hathorFederationContract = new prvdr.eth.Contract(HATHOR_FEDERATION_ABI, config.crossToNetwork.federation);
  } 
  
  const events = await hathorFederationContract.getPastEvents("AllEvents", {
    fromBlock: "earliest",
  });

  const walletAddress = $("#address").text();

  const transactionTypes = [ "0", "2" ];

  const approvedTransactionEvents = events.filter(
    (evt) =>
      evt.event === "ProposalSent" &&
      evt.returnValues.receiver === walletAddress &&
      transactionTypes.includes(evt.returnValues.transactionType)
  );
  
  const proposedTransactionsEvents = events.filter(
    (evt) =>
      evt.event === "TransactionProposed" &&
      evt.returnValues.receiver === walletAddress &&
      transactionTypes.includes(evt.returnValues.transactionType)
  );

  const approvedTransactionIds = approvedTransactionEvents.map((evt) => evt.returnValues.transactionId);
  
  const proposedTransactions = proposedTransactionsEvents
    .filter(evt => 
      !approvedTransactionIds.includes(evt.returnValues.transactionId))
    .map(handleProposalEvents);

  const claimedTxHashes = claims.map(claim => claim.transactionHash);

  const approvedTransactions = approvedTransactionEvents
      .filter(evt => 
        evt.returnValues.processed && 
        !claimedTxHashes.includes(Web3.utils.keccak256(evt.returnValues.transactionHash))
      )
      .map(handleProposalEvents);

  const acceptedTransactions = approvedTransactionEvents
      .filter(evt => 
        evt.returnValues.processed && 
        claimedTxHashes.includes(Web3.utils.keccak256(evt.returnValues.transactionHash))
      )
      .map(handleProposalEvents)
      .map(tx => mergeClaimAndProposal(claims.find(claim => claim.transactionHash === tx.transactionHash), tx))
      ;

  const evmOriginTokenTxs = [...proposedTransactions, ...approvedTransactions, ...acceptedTransactions];

  const evmOriginTokenTxsIds = evmOriginTokenTxs.map(tx => tx.transactionHash);

  const htrOriginTokenTxs = claims.filter(claim => !evmOriginTokenTxsIds.includes(claim.transactionHash))

  return [...evmOriginTokenTxs, ...htrOriginTokenTxs];
}

async function getPendingClaims() {    
  const events = await federationContract.getPastEvents("AllEvents", {
    fromBlock: "7375385",
  });
  const walletAddress = $("#address").text();
  const crossTransferEvents = events.filter(
    (evt) =>
      (evt.event === "Voted" || evt.event === "Executed") &&
      evt.returnValues.receiver === walletAddress
  );

  console.log(`Total voted events: ${crossTransferEvents.length}`);

  const executedTransfers = crossTransferEvents.filter(evt => evt.event === "Executed");
  console.log(`Total evecuted events: ${executedTransfers.length}`);
  const executedTransferIds = executedTransfers.map(et => et.returnValues.transactionId);
  const votedTransfers = crossTransferEvents.filter(evt => evt.event === "Voted" && !executedTransferIds.includes(evt.returnValues.transactionId));
  const uniqueVotedTransfers = [...new Map(votedTransfers.map(evt => [evt.returnValues.transactionId, {...evt, status: "processing_transfer"}])).values()];
  console.log(`Total unique voted events: ${uniqueVotedTransfers.length}`);
  const uniqueTransferEvents = [...executedTransfers, ...uniqueVotedTransfers];

  console.log(`Total unique events: ${uniqueTransferEvents.length}`);

  return await Promise.all(uniqueTransferEvents.map(handleTransferEvents));
}

function setStatusAction(status, tx) {
  let action = "";

  switch (status) {
    case "processing_transfer":
        action = "<p>Pending</p>"
      break;
    case "awaiting_claim":
        action = `<button 
                      class="btn btn-primary claim-button" 
                      data-token="${tx.originalTokenAddress}"
                      data-to="${tx.receiver}" 
                      data-amount="${tx.amount}" 
                      data-blockhash="${tx.transactionHash}" 
                      data-logindex="${tx.logIndex}" 
                      data-originchainid="${tx.originChainId}">
                      Claim
                  </button>`
      break;
    case "claimed":
        action = "<p>Claimed</p>"
      break;
  }

  return action;
}

function mergeClaimAndProposal(claim, proposal) {
  return {
    originalTokenAddress: proposal.originalTokenAddress,    
    transactionHash: proposal.transactionHash,
    amount: claim.amount,
    value: proposal.value,    
    sender: proposal.sender,
    receiver: proposal.receiver,    
    transactionType: proposal.transactionType,
    transactionId: proposal.transactionId,    
    logIndex: claim.logIndex,
    originChainId: claim.originChainId,
    status: claim.status
  }
}

function handleProposalEvents(event) {  
  const {
    originalTokenAddress,    
    transactionHash,
    value,    
    sender,
    receiver,    
    transactionType,
    transactionId
  } = event.returnValues;

  const hashedTx = Web3.utils.keccak256(transactionHash);

  return {
    sender,
    originalTokenAddress,
    receiver,    
    transactionHash: hashedTx,
    value,    
    transactionType,
    transactionId, 
    status: "processing_transfer"
  };
}

async function handleTransferEvents(event) {
  let {
    transactionHash,
    originalTokenAddress,
    receiver,
    amount,
    blockHash,
    logIndex,
		originChainId,
		destinationChainId
  } = event.returnValues;

  let transaction = {
      sender : "",
      originalTokenAddress,
      receiver,
      amount,
      transactionHash: blockHash,
      logIndex,
      originChainId,
    };

  if (event.status === "processing_transfer") {
    transaction.status = "processing_transfer";
    return transaction;
  }

  const txDataHash = await bridgeContract.methods
    .getTransactionDataHash(
      receiver,
      amount,
      blockHash,
      transactionHash,
      logIndex,
      originChainId,
      destinationChainId
    )
    .call();

  const isClaimed = await bridgeContract.methods
    .isClaimed(txDataHash, txDataHash)
    .call();

  transaction.status = isClaimed ? "claimed" : "awaiting_claim";

  return transaction;
}

async function waitForReceipt(txHash) {
  let timeElapsed = 0;
  let interval = 10_000;
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(async () => {
      timeElapsed += interval;
      let receipt = await web3.eth.getTransactionReceipt(txHash);
      if (receipt != null) {
        clearInterval(checkInterval);
        resolve(receipt);
      }
      if (timeElapsed > 90_000) {
        reject(
          new Error(
            `Operation took too long <a target="_blank" href="${config.explorer}/tx/${txHash}">check Tx on the explorer</a>`
          )
        );
      }
    }, interval);
  });
}

function onLogInClick() {
  if (!config) {
    $("#logIn").html('<i class="fas fa-sync fa-spin">');
    $("#logIn").attr("onclick", "");
    isInstalled().catch((err) => {
      onMetaMaskConnectionError(
        typeof err === "string" ? { message: err } : err
      );
    });
  }
}

function onPreviousTxnClick() {
  if ($("#nav-eth-htr-tab").attr("class").includes("active")) {
    if (eth2HtrPaginationObj != {} && eth2HtrPaginationObj.pre_page == null) {
      // no decrement applied
    } else {
      eth2HtrTablePage -= 1;
    }
  } else {
    if (htr2EthPaginationObj != {} && htr2EthPaginationObj.pre_page == null) {
      // no decrement applied
    } else {
      htr2EthTablePage -= 1;
    }
  }
  showActiveAddressTXNs();
}

function onNextTxnClick() {
  if ($("#nav-eth-htr-tab").attr("class").includes("active")) {
    if (eth2HtrPaginationObj != {} && eth2HtrPaginationObj.next_page == null) {
      // no increment applied
    } else {
      eth2HtrTablePage += 1;
    }
  } else {
    if (htr2EthPaginationObj != {} && htr2EthPaginationObj.next_page == null) {
      // no increment applied
    } else {
      htr2EthTablePage += 1;
    }
  }

  showActiveAddressTXNs();
}

// END CLAIMS

async function setInfoTab(tokenAddress) {
  try {

    const {limit} = await allowTokensContract.methods.getInfoAndLimits(tokenAddress).call();
    

    // Dinamically get the values, this is comented as the public node some times throws errors
    const federators = await federationContract.methods.getMembers().call();
    minTokensAllowed = parseInt(web3.utils.fromWei(limit.min, "ether"));
    maxTokensAllowed = parseInt(web3.utils.fromWei(limit.max, "ether"));
    maxDailyLimit = parseInt(web3.utils.fromWei(limit.daily, "ether"));

    feePercentage = await retry3Times(
      bridgeContract.methods.getFeePercentage().call
    );
    fee = feePercentage / feePercentageDivider;
    let feeFormated = (fee * 100).toFixed(2) + "%";
    let isValidatingAllowedTokens = true;

    $("#fee").html(feeFormated);
    $("#config-fee").text(feeFormated);
    $("#config-min").text(minTokensAllowed.toLocaleString());
    $("#config-max").text(maxTokensAllowed.toLocaleString());
    $("#config-to-spend").text(maxDailyLimit.toLocaleString());
    $("#config-federators-count").text(`${federators.length}`);
    $('#config-federators-required').text(`${Math.floor((federators.length / 2) + 1)}`);
    $("#config-whitelisted-enabled").html(
      `${config.crossToNetwork.confirmationTime}`
    );
  } catch (err) {
    console.error("Error setting info tab ", err);
  }
}

async function getMaxBalance(event) {
  //TODO understand if we need to change contract
  if(event)
      event.preventDefault();
  let tokenToCross = $('#tokenAddress').val();
  let token = TOKENS.find(element => element.token == tokenToCross);
  if(!token) {
      return;
  }
  const tokenAddress = token[config.networkId].address;
  tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const decimals = token[config.networkId].decimals;
  return retry3Times(tokenContract.methods.balanceOf(address).call)
  .then(async (balance) => {
      balanceBNs = new BigNumber(balance).shiftedBy(-decimals);
      let maxWithdrawInWei = await retry3Times(allowTokensContract.methods.calcMaxWithdraw(tokenAddress).call);
      let maxWithdraw = new BigNumber(web3.utils.fromWei(maxWithdrawInWei, 'ether'));
      let maxValue = 0;
      if( balanceBNs.isGreaterThan(maxWithdraw)) {
          maxValue = maxWithdraw;
      } else {
          maxValue = balanceBNs;
      }
      let serviceFee = new BigNumber(maxValue).times(fee);
      let value = maxValue.minus(serviceFee).toFixed(decimals, BigNumber.ROUND_DOWN);
      $('#amount').val(value.toString());
      $('#amount').keyup();
  });
}

async function approveSpend() {
  var tokenToCross = $("#tokenAddress").val();
  var token = TOKENS.find((element) => element.token == tokenToCross);
  if (!token) {
    crossTokenError("Choose a token to cross");
    return;
  }
  const isUnlimitedApproval = $("#doNotAskAgain").prop("checked");
  const BN = web3.utils.BN;
  const amount = $("#amount").val();

  if (!amount) {
    crossTokenError("Complete the Amount field");
    return;
  }
  if ($("#amount").hasClass("is-invalid")) {
    crossTokenError("Invalid Amount");
    return;
  }

  const decimals = token[config.networkId].decimals;
  const splittedAmount = amount.split(".");
  var amountWithDecimals = splittedAmount[0];
  for (i = 0; i < decimals; i++) {
    if (splittedAmount[1] && i < splittedAmount[1].length) {
      amountWithDecimals += splittedAmount[1][i];
    } else {
      amountWithDecimals += "0";
    }
  }

  const amountBN = isUnlimitedApproval
    ? new BN(web3.utils.toWei(Number.MAX_SAFE_INTEGER.toString(), "ether"))
    : new BN(amountWithDecimals)
        .mul(new BN(feePercentageDivider))
        .div(new BN(feePercentageDivider - feePercentage));

  var gasPriceParsed = 0;
  if (config.networkId >= 30 && config.networkId <= 33) {
    let block = await web3.eth.getBlock("latest");
    gasPriceParsed = parseInt(block.minimumGasPrice);
    gasPriceParsed = gasPriceParsed <= 1 ? 1 : gasPriceParsed * 1.03;
  } else {
    let gasPriceAvg = await web3.eth.getGasPrice();
    gasPriceParsed = parseInt(gasPriceAvg);
    gasPriceParsed = gasPriceParsed <= 1 ? 1 : gasPriceParsed * 1.3;
  }
  gasPrice = `0x${Math.ceil(gasPriceParsed).toString(16)}`;

  $("#wait").show();

  return new Promise((resolve, reject) => {
    tokenContract.methods
      .approve(
        bridgeContract.options.address,
        amountBN.mul(new BN(101)).div(new BN(100)).toString()
      )
      .send(
        { from: address, gasPrice: gasPrice, gas: 70_000 },
        async (err, txHash) => {
          if (err) return reject(err);
          try {
            let receipt = await waitForReceipt(txHash);
            if (receipt.status) {
              resolve(receipt);
            }
          } catch (err) {
            reject(err);
          }
          reject(
            new Error(
              `Execution failed <a target="_blank" href="${config.explorer}/tx/${txHash}">see Tx</a>`
            )
          );
        }
      );
  })
    .then(() => {
      $("#wait").hide();

      // approve disabled, cross tokens enabled
      disableApproveCross({
        approvalDisable: true,
        doNotAskDisabled: true,
        crossDisabled: false,
      });
    })
    .catch((err) => {
      $("#wait").hide();
      console.error(err);
      crossTokenError(`Couldn't approve amount. ${err.message}`);

      // all options disabled:
      disableApproveCross({
        approvalDisable: true,
        doNotAskDisabled: true,
        crossDisabled: true,
      });
    });
}

async function crossToken() {
  cleanAlertError();
  cleanAlertSuccess();
  var tokenToCross = $("#tokenAddress").val();
  var token = TOKENS.find((element) => element.token == tokenToCross);
  if (!token) {
    crossTokenError("Choose a token to cross");
    return;
  }
  const tokenAddress = token[config.networkId].address;
  tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const BN = web3.utils.BN;

  const amount = $("#amount").val();
  if (!amount) {
    crossTokenError("Complete the Amount field");
    return;
  }
  if ($("#amount").hasClass("is-invalid")) {
    crossTokenError("Invalid Amount");
    return;
  }

  const hathorAddress = $("#hathorAddress").val();
  if (!hathorAddress) {
    crossTokenError("Inform the hathor address!");
    return;
  }

  const decimals = token[config.networkId].decimals;
  const splittedAmount = amount.split(".");
  var amountWithDecimals = splittedAmount[0];
  for (i = 0; i < decimals; i++) {
    if (splittedAmount[1] && i < splittedAmount[1].length) {
      amountWithDecimals += splittedAmount[1][i];
    } else {
      amountWithDecimals += "0";
    }
  }
  const amountBN = new BN(amountWithDecimals)
    .mul(new BN(feePercentageDivider))
    .div(new BN(feePercentageDivider - feePercentage));
  const amountFeesBN =
    fee == 0
      ? amountBN
      : amountBN.mul(new BN(feePercentage)).div(new BN(feePercentageDivider));

  disableInputs(true);
  $(".fees").hide();
  $("#secondsPerBlock").text(config.secondsPerBlock);
  $("#wait").show();
  let gasPrice = "";

  console.log(`Amount sending: ${amountBN}`);

  return retry3Times(tokenContract.methods.balanceOf(address).call)
    .then(async (balance) => {
      const balanceBN = new BN(balance);
      if (balanceBN.lt(amountBN)) {
        const showBalance = new BigNumber(balance);
        throw new Error(
          `Insuficient Balance in your account, your current balance is ${showBalance.shiftedBy(
            -decimals
          )} ${token[config.networkId].symbol}`
        );
      }

      let maxWithdrawInWei = await retry3Times(allowTokensContract.methods.calcMaxWithdraw(tokenAddress).call);
      const maxWithdraw = new BN(maxWithdrawInWei);
      if(amountBN.gt(maxWithdraw)) {
          throw new Error(`Amount bigger than the daily limit. Daily limit left ${web3.utils.fromWei(maxWithdrawInWei, 'ether')} tokens`);
      }

      var gasPriceParsed = 0;
      if (config.networkId >= 30 && config.networkId <= 33) {
        let block = await web3.eth.getBlock("latest");
        gasPriceParsed = parseInt(block.minimumGasPrice);
        gasPriceParsed = gasPriceParsed <= 1 ? 1 : gasPriceParsed * 1.03;
      } else {
        let gasPriceAvg = await web3.eth.getGasPrice();
        gasPriceParsed = parseInt(gasPriceAvg);
        gasPriceParsed = gasPriceParsed <= 1 ? 1 : gasPriceParsed * 1.3;
      }
      gasPrice = `0x${Math.ceil(gasPriceParsed).toString(16)}`;
    })
    .then(async () => {
      return new Promise((resolve, reject) => {
        bridgeContract.methods
          .receiveTokensTo(31, tokenAddress, hathorAddress, amountBN.toString())
          .send(
            { from: address, gasPrice: gasPrice, gas: 200_000 },
            async (err, txHash) => {
              console.log(err);
              console.log(txHash);
              if (err) return reject(err);
              try {
                let receipt = await waitForReceipt(txHash);
                console.log(receipt);

                disableApproveCross({
                  approvalDisable: true,
                  doNotAskDisabled: true,
                  crossDisabled: true,
                });

                if (receipt.status) {
                  resolve(receipt);
                }
              } catch (err) {
                reject(err);
              }
              reject(
                new Error(
                  `Execution failed <a target="_blank" href="${config.explorer}/tx/${txHash}">see Tx</a>`
                )
              );
            }
          );
      });
    })
    .then(async (receipt) => {
      $("#wait").hide();
      $("#confirmationTime").text(config.confirmationTime);
      $("#receive").text(
        `${amount} ${token[config.crossToNetwork.networkId].symbol}`
      );
      $("#success").show();
      disableInputs(false);

      console.log("Before adding reciept to storage", TXN_Storage);

      // save transaction to local storage...
      TXN_Storage.addTxn(address, config.name, {
        networkId: config.networkId,
        tokenFrom: token[config.networkId].symbol,
        tokenTo: token[config.crossToNetwork.networkId].symbol,
        amount,
        ...receipt,
      });

      console.log("After adding receipt to storage", TXN_Storage);
      updateActiveAddressTXNs(address);
      showActiveTxnsTab();
      showActiveAddressTXNs();
    })
    .catch((err) => {
      $("#wait").hide();
      console.error(err);
      crossTokenError(`Couln't cross the tokens. ${err.message}`);
    });
}

function errorClaim(error) {
  $("#alert-danger-text_claim").html(error);
  $("#alert-danger_claim").show();
  $("#alert-danger_claim").focus();
}

async function claimToken(to, amount, blockHash, logIndex, originChainId) {
  clearInterval(poolingIntervalId);
  cleanAlertErrorClaim();
  cleanAlertSuccessClaim();

  if (!bridgeContract) {
    errorClaim("Connect your wallet!");
    return;
  }

  var gasPriceParsed = 0;
  if (config.networkId >= 30 && config.networkId <= 33) {
    let block = await web3.eth.getBlock("latest");
    gasPriceParsed = parseInt(block.minimumGasPrice);
    gasPriceParsed = gasPriceParsed <= 1 ? 1 : gasPriceParsed * 1.03;
  } else {
    let gasPriceAvg = await web3.eth.getGasPrice();
    gasPriceParsed = parseInt(gasPriceAvg);
    gasPriceParsed = gasPriceParsed <= 1 ? 1 : gasPriceParsed * 1.3;
  }
  const gasPrice = `0x${Math.ceil(gasPriceParsed).toString(16)}`;

  await bridgeContract.methods
    .claim({
      to: to,
      amount: amount,
      blockHash: blockHash,
      transactionHash: blockHash,
      logIndex: logIndex,
      originChainId: originChainId,
    })
    .send({ from: address, gasPrice: gasPrice, gas: 200_000 })
    .on('transactionHash', (hash) => {
      console.log(`txHash: ${hash}`);
    })
    .on('receipt', (receipt) => {
      console.log(receipt);
      startPoolingTxs();
    })
    .on('error', (error, receipt) => {
      console.log(error);
      console.log(receipt);
      startPoolingTxs();
    });
}

function cleanAlertSuccess() {
  $("#success").hide();
}

function cleanAlertError() {
  $("#alert-danger-text").html("");
  $("#alert-danger").hide();
}

function cleanAlertSuccessClaim() {
  $("#success_claim").hide();
}

function cleanAlertErrorClaim() {
  $("#alert-danger-text_claim").html("");
  $("#alert-danger_claim").hide();
}

function crossTokenError(err) {
  $("#alert-danger-text").html(err);
  $("#alert-danger").show();
  $("#alert-danger").focus();
  // $('#cross').prop('disabled', false);
  $("#deposit").prop("disabled", false);

  disableInputs(false);
}

async function checkAllowance() {
  cleanAlertSuccess();
  let amount = $("#amount").val();
  if (amount == "") {
    markInvalidAmount("Invalid amount");
    return;
  }
  let parsedAmount = new BigNumber(amount);
  if (parsedAmount <= 0) {
    markInvalidAmount("Must be bigger than 0");
    return;
  }
  $("#secondsPerBlock").text(config.secondsPerBlock);
  $("#amount").removeClass("ok");
  let totalCost = fee == 0 ? parsedAmount : parsedAmount.dividedBy(1 - fee);
  let serviceFee = totalCost.times(fee);

  let tokenToCross = $("#tokenAddress").val();
  let token = TOKENS.find((element) => element.token == tokenToCross);
  const tokenAddress = token[config.networkId].address;
  tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);

  let allowance = await retry3Times(
    tokenContract.methods.allowance(address, bridgeContract.options.address)
      .call
  );
  allowance = web3.utils.fromWei(allowance);
  let allowanceBN = new BigNumber(allowance);

  if (totalCost.lte(allowanceBN)) {
    $(".approve-deposit").hide();
    // straight to convert
    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: false,
    });
  } else {
    // user must first approve amount
    disableApproveCross({
      approvalDisable: false,
      doNotAskDisabled: false,
      crossDisabled: true,
    });
    $(".approve-deposit").show();
  }
}

async function isAmountOk() {
  cleanAlertSuccess();
  let amount = $("#amount").val();
  if (amount == "") {
    markInvalidAmount("Invalid amount");

    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: true,
    });

    return;
  }
  let parsedAmount = new BigNumber(amount);
  if (parsedAmount <= 0) {
    markInvalidAmount("Must be bigger than 0");

    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: true,
    });

    return;
  }
  $("#amount").removeClass("ok");
  let totalCost = fee == 0 ? parsedAmount : parsedAmount.dividedBy(1 - fee);
  let serviceFee = totalCost.times(fee);

  $("#serviceFee").html(serviceFee.toFormat(6, BigNumber.ROUND_DOWN));
  $("#totalCost").html(totalCost.toFormat(6, BigNumber.ROUND_DOWN));
  try {
    if (totalCost < minTokensAllowed) {
      throw new Error(
        `Minimum amount ${minTokensAllowed - minTokensAllowed * fee} token`
      );
    }
    if (totalCost > maxTokensAllowed) {
      throw new Error(
        `Max amount ${maxTokensAllowed - maxTokensAllowed * fee} tokens`
      );
    }

    $(".amount .invalid-feedback").hide();
    $("#amount").removeClass("is-invalid");
    $("#amount").addClass("ok");
    $(".fees").show();
  } catch (err) {
    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: true,
    });

    markInvalidAmount(err.message);
  }
}

function markInvalidAmount(errorDescription) {
  let invalidAmount = $(".amount .invalid-feedback");
  invalidAmount.html(errorDescription);
  invalidAmount.show();
  $("#amount").addClass("is-invalid");
  $("#amount").prop("disabled", false);
  $("#amount").removeClass("ok");
  $(".fees").hide();
}

async function isInstalled() {
  if (window.ethereum) {
    window.ethereum.autoRefreshOnNetworkChange = false;
  }

  const provider = await rLogin.connect().catch(() => {
    throw new Error("Login failed. Please try again.");
  });
  window.web3 = new Web3(provider);
  let accounts = await getAccounts();
  let chainId = await web3.eth.net.getId();
  await updateCallback(chainId, accounts);

  provider.on("chainChanged", function (newChain) {
    updateNetwork(newChain);
    showActiveTxnsTab();
  });
  provider.on("accountsChanged", function (newAddresses) {
    checkAllowance();
    updateAddress(newAddresses)
      .then((addr) => updateActiveAddressTXNs(addr))
      .then(() => showActiveAddressTXNs());
  });
  return chainId;
}

function onMetaMaskConnectionError(err) {
  console.log(err);
  showModal("Connect wallet", err.message);
  $("#logIn").attr("onclick", "onLogInClick()");
  $("#logIn").text("Connect wallet");
  $("#logIn").show();
  $("#transferTab").addClass("disabled");
  $(".wallet-status").hide();
  $("#address").text("0x00000..");
  disableInputs(true);
  tokenContract = null;
  allowTokensContract = null;
  bridgeContract = null;
  config = null;
  address = "";
}

function showModal(title, message) {
  $("#myModal .modal-title").html(title);
  $("#myModal .modal-body").html(`<p>${message}</p>`);
  $("#myModal").modal("show");
}

function disableApproveCross({
  approvalDisable = true,
  doNotAskDisabled = true,
  crossDisabled = true,
}) {
  $("#approve").prop("disabled", approvalDisable);
  $("#doNotAskAgain").prop("disabled", doNotAskDisabled);
  $("#deposit").prop("disabled", crossDisabled);
}

function disableClaim({ searchDisable = true, claimDisabled = true }) {
  $("#searchClaim").prop("disabled", searchDisable);
  $("#claim").prop("disabled", claimDisabled);
}

function disableInputs(disable) {
  $("#tokenAddress").prop("disabled", disable);
  $("button[data-id='tokenAddress']").prop("disabled", disable);
  $("#amount").prop("disabled", disable);
  if (disable) {
    $("#max").off("click");
    $("#max").removeAttr("href");
  } else {
    $("#max").on("click", getMaxBalance);
    $("#max").attr("href", "#");
  }
}

function onMetaMaskConnectionSuccess() {
  disableInputs(false);
  disableApproveCross({
    approvalDisable: true,
    doNotAskDisabled: true,
    crossDisabled: true,
  });
  disableClaim({
    searchDisable: false,
    claimDisabled: true,
  });
}

function updateAddress(newAddresses) {
  address = newAddresses[0];
  $("#address").text(address);
  $("#logIn").hide();
  $("#transferTab").removeClass("disabled");
  $("#claimTab").removeClass("disabled");
  $(".wallet-status").show();

  return Promise.resolve(address);
}

function updateActiveAddressTXNs() {
  activeAddresseth2HtrTxns = TXN_Storage.getAllTxns4Address(
    address,
    config.crossToNetwork.name
  );
  activeAddresshtr2EthTxns = TXN_Storage.getAllTxns4Address(
    address,
    config.name
  );
}

function showActiveTxnsTab() {
  if (config.name.toLowerCase().includes("eth")) {
    showEvmTxsnTabe();
  } else {
    showHtrTxsnTabe();
  }
}

function showEvmTxsnTabe() {
  $("#nav-eth-htr-tab").addClass("active").attr("aria-selected", true);
  $("#nav-eth-htr").addClass("active show");
  $("#nav-htr-eth-tab").removeClass("active").attr("aria-selected", false);
  $("#nav-htr-eth").removeClass("active show");
}

function showHtrTxsnTabe() {
  $("#nav-htr-eth-tab").addClass("active").attr("aria-selected", true);
  $("#nav-htr-eth").addClass("active show");
  $("#nav-eth-htr-tab").attr("aria-selected", false).removeClass("active");
  $("#nav-eth-htr").removeClass("active show");
}

function showActiveAddressTXNs() {
  if (
    !address ||
    (!activeAddresseth2HtrTxns.length && !activeAddresshtr2EthTxns.length)
  ) {
    $("#previousTxnsEmptyTab").css("margin-bottom", "6em").show();
    $("#previousTxnsTab").hide();
    return;
  }

  $("#previousTxnsEmptyTab").css("margin-bottom", "0em").hide();
  $("#previousTxnsTab").show().css("margin-bottom", "6em");
  $("#txn-previous").off().on("click", onPreviousTxnClick);
  $("#txn-next").off().on("click", onNextTxnClick);

  let eth2HtrTable = $("#eth-htr-tbody");
  let htr2EthTable = $("#htr-eth-tbody");

  eth2HtrPaginationObj = Paginator(
    activeAddresseth2HtrTxns,
    eth2HtrTablePage,
    3
  );
  let { data: eth2HtrTxns } = eth2HtrPaginationObj;

  htr2EthPaginationObj = Paginator(
    activeAddresshtr2EthTxns,
    htr2EthTablePage,
    3
  );
  let { data: htr2EthTxns } = htr2EthPaginationObj;

  let currentNetwork = $(".indicator span").text();

  const processHtrTxn = (txn, config = {}) => {
    let htmlRow = `<tr class="black">
        <td>${txn.sender}</td>
        <td>${txn.amount} ${txn.token}</td>
        <td>${txn.action}</td>
    </tr>`;

    return htmlRow;
  };

  const processTxn = (txn, config = {}) => {
    const { confirmations, secondsPerBlock, explorer } = config;

    let isConfig4CurrentNetwork = config.name === currentNetwork;

    let elapsedBlocks = currentBlockNumber - txn.blockNumber;
    let remainingBlocks2Confirmation = confirmations - elapsedBlocks;
    let status = isConfig4CurrentNetwork
      ? elapsedBlocks >= confirmations
        ? `<span class="confirmed"> Confirmed</span>`
        : `<span class="pending"> Pending</span>`
      : `Info Not Available`;

    let confirmationTime = confirmations * secondsPerBlock;
    let seconds2Confirmation =
      remainingBlocks2Confirmation > 0
        ? remainingBlocks2Confirmation * secondsPerBlock
        : 0;

    let hoursToConfirmation = Math.floor(seconds2Confirmation / 60 / 60);
    let hoursToConfirmationStr =
      hoursToConfirmation > 0 ? `${hoursToConfirmation}hs ` : ``;
    let minutesToConfirmation =
      Math.floor(seconds2Confirmation / 60) - hoursToConfirmation * 60;
    let humanTimeToConfirmation = isConfig4CurrentNetwork
      ? elapsedBlocks >= confirmations
        ? ``
        : `| ~ ${hoursToConfirmationStr} ${minutesToConfirmation}mins`
      : ``;

    let txnExplorerLink = `${explorer}/tx/${txn.transactionHash}`;
    let shortTxnHash = `${txn.transactionHash.substring(
      0,
      8
    )}...${txn.transactionHash.slice(-8)}`;

    let htmlRow = `<tr class="black">
            <th scope="row"><a class="confirmed" href="${txnExplorerLink}">${shortTxnHash}</a></th>
            <td>${txn.blockNumber}</td>
            <td>${txn.amount} ${txn.tokenFrom}</td>
            <td>${status} ${humanTimeToConfirmation}</td>
        </tr>`;

    return htmlRow;
  };

  const activeAddressTXNseth2HtrRows = eth2HtrTxns.map((txn) => {
    return processHtrTxn(txn, config.crossToNetwork);
  });
  const activeAddressTXNshtr2EthRows = htr2EthTxns.map((txn) => {
    return processTxn(txn, config);
  });

  eth2HtrTable.html(activeAddressTXNseth2HtrRows.join());
  htr2EthTable.html(activeAddressTXNshtr2EthRows.join());
  setClaimButtons();
}

function setClaimButtons() {
  document
    .querySelectorAll(".claim-button:not([disabled])")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        button.setAttribute('disabled', 'true');

        const to = button.getAttribute("data-to");
        const amount = button.getAttribute("data-amount");
        const blockHash = button.getAttribute("data-blockhash");
        const logIndex = button.getAttribute("data-logindex");
        const originChainId = button.getAttribute("data-originchainid");

        claimToken(to, amount, blockHash, logIndex, originChainId);
      });
    });

  $("#wait_claim_nomessage").hide();
}

async function updateCallback(chainId, accounts) {
  return updateNetwork(chainId)
    .then(() => updateAddress(accounts))
    .then((addr) => updateActiveAddressTXNs(addr))
    .then(fillHathorToEvmTxs)
    .then(showActiveAddressTXNs)    
    ;
}

function updateNetworkConfig(config) {
  $(".fromNetwork").text(config.name);
  $(".indicator span").html(config.name);
  $(".indicator").removeClass("btn-outline-danger");
  $(".indicator").addClass("btn-outline-success");
  $(".toNetwork").text(config.crossToNetwork.name);
  $("#confirmations").html(config.confirmations);
  $("#timeToCross").html(config.crossToNetwork.confirmationTime);
  updateTokenAddressDropdown(config.networkId);
}

async function updateNetwork(newNetwork) {
  cleanAlertSuccess();
  try {
    newNetwork = parseInt(newNetwork);
    if (config && config.networkId == newNetwork) return;

    config = null;
    if (isTestnet) {
      switch (newNetwork) {
        case 11155111:
          config = SEPOLIA_CONFIG;
          break;
      }
    } else {
      switch (newNetwork) {
        case 1:
          config = ETH_CONFIG;
          break;
      }
    }
    if (config == null) {
      $(".fromNetwork").text("From Network");
      $(".indicator span").html("Unknown Network");
      $(".indicator").removeClass("btn-outline-success");
      $(".indicator").addClass("btn-outline-danger");
      $(".toNetwork").text("To Network");
      $("#willReceiveToken").html("");
      throw new Error(
        `Wrong Network.<br /> Please connect your wallet to <b>${
          isTestnet ? "Sepolia" : "Ethereum Mainnet"
        }</b>`
      );
    }
    allowTokensContract = new web3.eth.Contract(
      ALLOW_TOKENS_ABI,
      config.allowTokens
    );
    bridgeContract = new web3.eth.Contract(BRIDGE_ABI, config.bridge);
    federationContract = new web3.eth.Contract(
      FEDERATION_ABI,
      config.federation
    );

    $("#myModal").modal("hide");
    updateNetworkConfig(config);
    updateTokenAddressDropdown(config.networkId);

    // setInfoTab();
    onMetaMaskConnectionSuccess();

    await startPoolingTxs();

    if (TXN_Storage.isStorageAvailable("localStorage")) {
      console.log(`Local Storage Available!`);
    } else {
      console.log(`Local Storage Unavailable!`);
    }

  } catch (err) {
    onMetaMaskConnectionError(err);
    throw err;
  }
}

async function startPoolingTxs() {
  poolingIntervalId = await poll4LastBlockNumber(async function (
      blockNumber
    ) {
      currentBlockNumber = blockNumber;
      await fillHathorToEvmTxs();
      showActiveAddressTXNs();
    });
}

function updateTokenAddressDropdown(networkId) {
  let selectHtml = "";
  for (let aToken of TOKENS) {
    if (aToken[networkId] != undefined) {
      selectHtml += `\n<option value="${aToken.token}" `;
      selectHtml += `data-content="<span><img src='${aToken.icon}' class='token-logo'></span>${aToken[networkId].symbol}">`;
      selectHtml += `\n</option>`;
    }
  }
  $("#tokenAddress").html(selectHtml);
  $("#tokenAddress").prop("disabled", false);
  $("#tokenAddress").selectpicker("refresh");
  $("#willReceiveToken").html("");
}

function updateTokenListTab() {
  let htrConfig = SEPOLIA_CONFIG;
  if (!isTestnet) htrConfig = ETH_CONFIG;

  let tabHtml = `<div class="row mb-3 justify-content-center text-center">`;
  tabHtml += `\n    <div class="col-5">`;
  tabHtml += `\n        ${htrConfig.name}`;
  tabHtml += `\n    </div>`;
  tabHtml += `\n    <div class="col-1"></div>`;
  tabHtml += `\n    <div class="col-5">`;
  tabHtml += `\n        ${htrConfig.crossToNetwork.name}`;
  tabHtml += `\n    </div>`;
  tabHtml += `\n</div>`;
  for (let aToken of TOKENS) {
    if (aToken[htrConfig.networkId] != undefined) {
      tabHtml += `\n<div class="row mb-3 justify-content-center">`;
      tabHtml += `\n    <div class="col-5 row">`;
      tabHtml += `\n      <div class="col-8 font-weight-bold">`;
      tabHtml += `\n          <a href="${htrConfig.explorer}/address/${aToken[
        htrConfig.networkId
      ].address.toLowerCase()}" class="address" target="_blank">`;
      tabHtml += `\n            <span><img src="${
        aToken.icon
      }" class="token-logo"></span>${aToken[htrConfig.networkId].symbol}`;
      tabHtml += `\n          </a>`;
      tabHtml += `\n       </div>`;
      tabHtml += `\n       <div class="col-4">`;
      tabHtml += `\n           <button class="copy btn btn-outline-secondary" type="button" data-clipboard-text="${aToken[
        htrConfig.networkId
      ].address.toLowerCase()}" data-toggle="tooltip" data-placement="bottom" title="Copy token address to clipboard">`;
      tabHtml += `\n                <i class="far fa-copy"></i>`;
      tabHtml += `\n           </button>`;
      tabHtml += `\n       </div>`;
      tabHtml += `\n    </div>`;
      tabHtml += `\n    <div class="col-2 text-center">`;
      tabHtml += `\n        <i class="fas fa-arrows-alt-h"></i>`;
      tabHtml += `\n    </div>`;
      tabHtml += `\n    <div class="col-5 row">`;
      tabHtml += `\n      <div class="col-8 font-weight-bold">`;
      tabHtml += `\n          <a href="${
        htrConfig.crossToNetwork.explorer
      }/${htrConfig.crossToNetwork.explorerTokenTab}/${aToken[
        htrConfig.crossToNetwork.networkId
      ].pureHtrAddress.toLowerCase()}" class="address" target="_blank">`;
      tabHtml += `\n              <span><img src="${
        aToken.icon
      }" class="token-logo"></span>${
        aToken[htrConfig.crossToNetwork.networkId].symbol
      }`;
      tabHtml += `\n          </a>`;
      tabHtml += `\n      </div>`;
      tabHtml += `\n      <div class="col-4">`;
      tabHtml += `\n          <button class="copy btn btn-outline-secondary" type="button" data-clipboard-text="${aToken[
        htrConfig.crossToNetwork.networkId
      ].pureHtrAddress.toLowerCase()}" data-toggle="tooltip" data-placement="bottom" title="Copy the address">`;
      tabHtml += `\n              <i class="far fa-copy"></i>`;
      tabHtml += `\n          </button>`;
      tabHtml += `\n      </div>`;
      tabHtml += `\n    </div>`;
      tabHtml += `\n</div>`;
    }
  }
  $("#tokenListTab").html(tabHtml);
}

async function getAccounts() {
  let accounts = await web3.eth.getAccounts();
  if (accounts.length === 0)
    throw new Error(
      "Nifty Wallet or MetaMask is Locked, please unlock it and Reload the page to continue"
    );
  return accounts;
}

// --------- CONFIGS ----------
let SEPOLIA_CONFIG = {
  networkId: 11155111,
  name: "Sepolia",
  bridge: "0x7e11388186127b720513864bb445882ae611e1f6",
  allowTokens: "0x278f39c10128e0e23bb1b65f0b4187200a9b061b",
  federation: "0x7a48b9cd441f2457c5131fe1cb6301110fe3e6cd",
  explorer: "https://sepolia.etherscan.io",
  explorerTokenTab: "#tokentxns",
  confirmations: 10,
  confirmationTime: "30 minutes",
  secondsPerBlock: 5,
};
let HTR_TESTNET_CONFIG = {
  networkId: 31,
  name: "Golf",
  federation: "0xeB8457a67e5575FbE350b9A7084D1eEa7B5415F7",
  explorer: "https://explorer.testnet.hathor.network",
  explorerTokenTab: "token_detail",
  confirmations: 2,
  confirmationTime: "30 minutes",
  secondsPerBlock: 30,
  crossToNetwork: SEPOLIA_CONFIG,
};
SEPOLIA_CONFIG.crossToNetwork = HTR_TESTNET_CONFIG;

// Replace with proper values contracts exist in mainnet
let ETH_CONFIG = {
  networkId: 1,
  name: "ETH Mainnet",
  bridge: "0x12ed69359919fc775bc2674860e8fe2d2b6a7b5d",
  allowTokens: "0xe4aa0f414725c9322a1a9d80d469c5e234786653",
  federation: "0x479f86ecbe766073d2712ef418aceb56d5362a2b",
  explorer: "https://etherscan.io",
  explorerTokenTab: "#tokentxns",
  confirmations: 5760,
  confirmationTime: "24 hours",
  secondsPerBlock: 15,
};
let HTR_MAINNET_CONFIG = {
  networkId: 30,
  name: "Hathor Mainnet",
  bridge: "0x9d11937e2179dc5270aa86a3f8143232d6da0e69",
  allowTokens: "0xe4aa0f414725c9322a1a9d80d469c5e234786653",
  federation: "0xe37b6516f4fe2a27569a2751c1ad50f6340df369",
  explorer: "https://explorer.hathor.network/",
  explorerTokenTab: "?__tab=tokens%20transfers",
  confirmations: 2880,
  confirmationTime: "24 hours",
  secondsPerBlock: 30,
  crossToNetwork: ETH_CONFIG,
};
ETH_CONFIG.crossToNetwork = HTR_MAINNET_CONFIG;
// --------- CONFIGS  END --------------

// --------- ABI --------------
let BRIDGE_ABI, ALLOW_TOKENS_ABI, ERC20_ABI, FEDERATION_ABI, HATHOR_FEDERATION_ABI; 
loadAbi('bridge', (abi) => { BRIDGE_ABI = abi; });
loadAbi('allowtokens', (abi) => { ALLOW_TOKENS_ABI = abi; });
loadAbi('erc20', (abi) => { ERC20_ABI = abi; });
loadAbi('federation', (abi) => { FEDERATION_ABI = abi; });
loadAbi('hathorFederation', (abi) => { HATHOR_FEDERATION_ABI = abi; });

function loadAbi(abi, callback) {
  fetch(`../abis/${abi}.json`)
    .then(async (response) => 
    {
      const abi = await response.json()
      callback(abi);
    });
};

// --------- ABI  END --------------

// --------- TOKENS --------------
const HATHOR_NATIVE_TOKEN = {
  token: "eHTR",
  name: "Hathor Token",
  icon: "https://s2.coinmarketcap.com/static/img/coins/64x64/5552.png",
  11155111: {
    symbol: "eHTR",
    address: "0xBd8A2Feba2724f0463F7C803D80340F6B2596a1A",
    decimals: 18,
  },
  31: {
    symbol: "HTR",
    address: "0xE3f0Ae350EE09657933CD8202A4dd563c5af941F",
    hathorAddr: "00",
    pureHtrAddress: "00",
    decimals: 18,
  },
};

const EVM_NATIVE_TOKEN = {
  token: "SLT7",
  name: "Storm Labs Token 7",
  icon: "https://assets.coingecko.com/coins/images/279/standard/ethereum.png?1696501628",
  11155111: {
    symbol: "SLT7",
    address: "0x97118caaE1F773a84462490Dd01FE7a3e7C4cdCd",
    decimals: 18,
  },
  31: {
    symbol: "hSLT7",
    address: "0xAF8aD2C33c2c9a48CD906A4c5952A835FeB25696",
    hathorAddr: "0x000002c993795c9ef5b894571af2277aaf344438c2f8608a50daccc6ace7c0a1",
    pureHtrAddress: "000002c993795c9ef5b894571af2277aaf344438c2f8608a50daccc6ace7c0a1",
    decimals: 18,
  },
};

const USDC_TOKEN = {
  token: "USDC",
  name: "USDC",
  icon: "https://assets.coingecko.com/coins/images/6319/standard/usdc.png?1696506694",
  11155111: {
    symbol: "USDC",
    address: "0x3E1Adb4e24a48B90ca10c28388cE733a6267BAc4",
    decimals: 6,
  },
  31: {
    symbol: "hUSDC",
    address: "0xA3FBbF66380dEEce7b7f7dC4BEA6267c05bB383D",
    hathorAddr: "0x000000005c3e8f7118140bcfbf2032a1a0abbca3b47205731880bba6b87cba8f",
    pureHtrAddress: "000000005c3e8f7118140bcfbf2032a1a0abbca3b47205731880bba6b87cba8f",
    decimals: 6,
  },
};

const TOKENS = [HATHOR_NATIVE_TOKEN, EVM_NATIVE_TOKEN, USDC_TOKEN];
// --------- TOKENS  END --------------
