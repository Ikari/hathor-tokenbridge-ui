//User
let address = "";
let activeAddressEth2RskTxns = [];
let eth2RskTablePage = 1;
let eth2RskPaginationObj = {};
let activeAddressRsk2EthTxns = [];
let rsk2EthTablePage = 1;
let rsk2EthPaginationObj = {};
//Network configuration
let config = null;
let isTestnet = true;
let allowTokensContract = null;
let bridgeContract = null;
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
    changeToClaim();
  });

  $("#claim").on("click", function (e) {
    e.preventDefault();
    claimToken();
  });

  $("#tokenAddress").change(function (event) {
    cleanAlertSuccess();
    let token = TOKENS.find(
      (element) => element.token == event.currentTarget.value
    );
    if (token) {
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

    setInfoTab(token[11155111].address);
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
  $("#refresh-claim").on("click", function () {
    fillClaims();
  });
  updateTokenListTab();
  // isInstalled(); - uncomment to show popup on page load
});

async function changeToClaim() {
  $("#claimTokens span").toggle();
  $(".subtitle").toggle();
  $("#transferTab").toggle();
  $("#claimTab").toggle();

  fillClaims();
}

async function fillClaims() {
  $("#claims-tbody").html("");
  $("#wait_claim_nomessage").show();
  let html = "";

  const claims = await getPendingClaims();

  if (!claims.length) {
    html += '<tr><td colspan="3">No claims found</td></tr>';
  }

  for (const claim of claims) {
    const {
      _originalTokenAddress,
      _to,
      _amount,
      _blockHash,
      _logIndex,
      _originChainId,
      isClaimed,
    } = claim;

    const tk = TOKENS.find(
      (token) => token[31].address === _originalTokenAddress
    );

    html += `
            <tr>
                <td>${tk.name}</td>
                <td>${web3.utils.fromWei(_amount, "ether")}</td>
                <td>
                    <!-- Claim button -->
                    ${
                      isClaimed
                        ? '<button class="btn btn-primary claim-button" disabled>Claimed</button>'
                        : `<button 
                            class="btn btn-primary claim-button" 
                            data-to="${_to}" 
                            data-amount="${_amount}" 
                            data-blockhash="${_blockHash}" 
                            data-logindex="${_logIndex}" 
                            data-originchainid="${_originChainId}">
                            Claim
                        </button>`
                    }
                </td>
            </tr>
        `;
  }

  $("#claims-tbody").html(html);

  // Add an event listener after rendering the buttons
  document
    .querySelectorAll(".claim-button:not([disabled])")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();

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
  if ($("#nav-eth-rsk-tab").attr("class").includes("active")) {
    if (eth2RskPaginationObj != {} && eth2RskPaginationObj.pre_page == null) {
      // no decrement applied
    } else {
      eth2RskTablePage -= 1;
    }
  } else {
    if (rsk2EthPaginationObj != {} && rsk2EthPaginationObj.pre_page == null) {
      // no decrement applied
    } else {
      rsk2EthTablePage -= 1;
    }
  }
  showActiveAddressTXNs();
}

function onNextTxnClick() {
  if ($("#nav-eth-rsk-tab").attr("class").includes("active")) {
    if (eth2RskPaginationObj != {} && eth2RskPaginationObj.next_page == null) {
      // no increment applied
    } else {
      eth2RskTablePage += 1;
    }
  } else {
    if (rsk2EthPaginationObj != {} && rsk2EthPaginationObj.next_page == null) {
      // no increment applied
    } else {
      rsk2EthTablePage += 1;
    }
  }

  showActiveAddressTXNs();
}

async function getPendingClaims() {
  console.log("evaluating past claims...");
  const events = await bridgeContract.getPastEvents("AllEvents", {
    fromBlock: "7375385",
  });
  const walletAddress = $("#address").text();
  const crossTransferEvents = events.filter(
    (evt) =>
      evt.event === "AcceptedCrossTransfer" &&
      evt.returnValues._to === walletAddress
  );
  console.log(`${crossTransferEvents.length} events found...`);
  const claims = [];
  for (const event of crossTransferEvents) {
    const claim = await handleAcceptedCrossTransferEvent(event);

    if (claim) {
      claims.push(claim);
    }
  }

  return claims;
}

async function handleAcceptedCrossTransferEvent(event) {
  let {
    _transactionHash,
    _originalTokenAddress,
    _to,
    _from,
    _amount,
    _blockHash,
    _logIndex,
    _originChainId,
    _destinationChainId,
  } = event.returnValues;

  console.log(
    `
            Processing transaction: ${_transactionHash} \n 
            from: ${_from}\n
            to: ${_to} \n
            amount: ${_amount}
        `
  );

  const txDataHash = await bridgeContract.methods
    .getTransactionDataHash(
      _to,
      _amount,
      _blockHash,
      _transactionHash,
      _logIndex,
      _originChainId,
      _destinationChainId
    )
    .call();

  const isClaimed = await bridgeContract.methods
    .isClaimed(txDataHash, txDataHash)
    .call();

  if (isClaimed) {
    return null;
  }

  const transaction = {
    _from,
    _originalTokenAddress,
    _to,
    _amount,
    _blockHash,
    _logIndex,
    _originChainId,
    isClaimed,
  };

  return transaction;
}

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
    //$('#config-federators-required').text(`${Math.floor((federators.length / 2) + 1)}`);
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
      let maxWithdrawInWei = await retry3Times(bridgeContract.methods.calcMaxWithdraw().call);
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
      //TODO understand if is going to be a issue
      // let maxWithdrawInWei = await retry3Times(bridgeContract.methods.calcMaxWithdraw().call);
      // const maxWithdraw = new BN(maxWithdrawInWei);
      // if(amountBN.gt(maxWithdraw)) {
      //     throw new Error(`Amount bigger than the daily limit. Daily limit left ${web3.utils.fromWei(maxWithdrawInWei, 'ether')} tokens`);
      // }

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
  cleanAlertErrorClaim();
  cleanAlertSuccessClaim();

  if (!bridgeContract) {
    errorClaim("Connect your wallet!");
    return;
  }

  console.log(to);
  console.log(amount);
  console.log(blockHash);
  console.log(logIndex);
  console.log(originChainId);

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

  const txHash = await bridgeContract.methods
    .claim({
      to: to,
      amount: amount,
      blockHash: blockHash,
      transactionHash: blockHash,
      logIndex: logIndex,
      originChainId: originChainId,
    })
    .send({ from: address, gasPrice: gasPrice, gas: 200_000 })
    .catch((err) => {
      console.log(err);
    });

  console.log(`txHash: ${txHash}`);

  let receipt = await waitForReceipt(txHash);
  console.log(receipt);
  if (receipt.status) {
    $("#success").show();
  }
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

function updateActiveAddressTXNs(addr) {
  if (config.name.toLowerCase().includes("eth")) {
    activeAddressEth2RskTxns = TXN_Storage.getAllTxns4Address(
      address,
      config.name
    );
    activeAddressRsk2EthTxns = TXN_Storage.getAllTxns4Address(
      address,
      config.crossToNetwork.name
    );
  } else {
    activeAddressRsk2EthTxns = TXN_Storage.getAllTxns4Address(
      address,
      config.name
    );
    activeAddressEth2RskTxns = TXN_Storage.getAllTxns4Address(
      address,
      config.crossToNetwork.name
    );
  }
}

function showActiveTxnsTab() {
  if (config.name.toLowerCase().includes("eth")) {
    $("#nav-eth-rsk-tab").addClass("active").attr("aria-selected", true);

    $("#nav-eth-rsk").addClass("active show");

    $("#nav-rsk-eth-tab").removeClass("active").attr("aria-selected", false);

    $("#nav-rsk-eth").removeClass("active show");
  } else {
    $("#nav-rsk-eth-tab").addClass("active").attr("aria-selected", true);

    $("#nav-rsk-eth").addClass("active show");

    $("#nav-eth-rsk-tab").attr("aria-selected", false).removeClass("active");

    $("#nav-eth-rsk").removeClass("active show");
  }
}

function showActiveAddressTXNs() {
  if (
    !address ||
    (!activeAddressEth2RskTxns.length && !activeAddressRsk2EthTxns.length)
  ) {
    $("#previousTxnsEmptyTab").css("margin-bottom", "6em").show();
    $("#previousTxnsTab").hide();
    return;
  }

  $("#previousTxnsEmptyTab").css("margin-bottom", "0em").hide();
  $("#previousTxnsTab").show().css("margin-bottom", "6em");
  $("#txn-previous").off().on("click", onPreviousTxnClick);
  $("#txn-next").off().on("click", onNextTxnClick);

  let eth2RskTable = $("#eth-rsk-tbody");
  let rsk2EthTable = $("#rsk-eth-tbody");

  eth2RskPaginationObj = Paginator(
    activeAddressEth2RskTxns,
    eth2RskTablePage,
    3
  );
  let { data: eth2RskTxns } = eth2RskPaginationObj;

  rsk2EthPaginationObj = Paginator(
    activeAddressRsk2EthTxns,
    rsk2EthTablePage,
    3
  );
  let { data: rsk2EthTxns } = rsk2EthPaginationObj;

  let currentNetwork = $(".indicator span").text();

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

  let activeAddressTXNsEth2RskRows;
  let activeAddressTXNsRsk2EthRows;

  if (config.name.toLowerCase().includes("eth")) {
    activeAddressTXNsEth2RskRows = eth2RskTxns.map((txn) => {
      return processTxn(txn, config);
    });
    activeAddressTXNsRsk2EthRows = rsk2EthTxns.map((txn) => {
      return processTxn(txn, config.crossToNetwork);
    });
  } else {
    activeAddressTXNsEth2RskRows = eth2RskTxns.map((txn) => {
      return processTxn(txn, config.crossToNetwork);
    });
    activeAddressTXNsRsk2EthRows = rsk2EthTxns.map((txn) => {
      return processTxn(txn, config);
    });
  }

  eth2RskTable.html(activeAddressTXNsEth2RskRows.join());
  rsk2EthTable.html(activeAddressTXNsRsk2EthRows.join());
}

async function updateCallback(chainId, accounts) {
  return updateNetwork(chainId)
    .then(() => updateAddress(accounts))
    .then((addr) => updateActiveAddressTXNs(addr))
    .then(() => showActiveAddressTXNs());
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

    let pollingLastBlockIntervalId = await poll4LastBlockNumber(function (
      blockNumber
    ) {
      currentBlockNumber = blockNumber;
      showActiveAddressTXNs();
    });

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
  if (!isTestnet) htrConfig = HTR_MAINNET_CONFIG;

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
      }/address/${aToken[
        htrConfig.crossToNetwork.networkId
      ].address.toLowerCase()}" class="address" target="_blank">`;
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
      ].address.toLowerCase()}" data-toggle="tooltip" data-placement="bottom" title="Copy the address">`;
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
  bridge: "0x2792efdb1c0dc6593054f0aa3997c09bf4fb4604",
  allowTokens: "0x403cfe7a73e821894160b5dee1f9952c3e917a7d",
  federation: "0x5b3ab7f427c9ea14e8eabd2975dfee2bb7603ccf",
  explorer: "https://sepolia.etherscan.io/",
  explorerTokenTab: "#tokentxns",
  confirmations: 10,
  confirmationTime: "30 minutes",
  secondsPerBlock: 5,
};
let HTR_TESTNET_CONFIG = {
  networkId: 31,
  name: "Golf",
  bridge: "0x2792efdb1c0dc6593054f0aa3997c09bf4fb4604",
  allowTokens: "0x403cfe7a73e821894160b5dee1f9952c3e917a7d",
  federation: "0x5b3ab7f427c9ea14e8eabd2975dfee2bb7603ccf",
  explorer: "https://explorer.testnet.hathor.network/",
  explorerTokenTab: "token_detail/",
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
const BRIDGE_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "_transactionHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_originalTokenAddress",
        type: "address",
      },
      { indexed: true, internalType: "address", name: "_to", type: "address" },
      {
        indexed: false,
        internalType: "address",
        name: "_from",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "_blockHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_logIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_originChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_destinationChainId",
        type: "uint256",
      },
    ],
    name: "AcceptedCrossTransfer",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_newAllowTokens",
        type: "address",
      },
    ],
    name: "AllowTokensChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "_transactionHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_originalTokenAddress",
        type: "address",
      },
      { indexed: true, internalType: "address", name: "_to", type: "address" },
      {
        indexed: false,
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "_blockHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_logIndex",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "_reciever",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "_relayer",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_fee",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_destinationChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_originChainId",
        type: "uint256",
      },
    ],
    name: "Claimed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_tokenAddress",
        type: "address",
      },
      { indexed: false, internalType: "string", name: "_to", type: "string" },
      {
        indexed: true,
        internalType: "uint256",
        name: "_destinationChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "_from",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_originChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "_userData",
        type: "bytes",
      },
    ],
    name: "Cross",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_newFederation",
        type: "address",
      },
    ],
    name: "FederationChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
    ],
    name: "FeePercentageChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "token",
        type: "address",
      },
      { indexed: false, internalType: "string", name: "uid", type: "string" },
    ],
    name: "HathorTokenMapped",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "_newSideTokenAddress",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "_originalTokenAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "string",
        name: "_newSymbol",
        type: "string",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_granularity",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "_chainId",
        type: "uint256",
      },
    ],
    name: "NewSideToken",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Paused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "PauserAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "PauserRemoved",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_newSideTokenFactory",
        type: "address",
      },
    ],
    name: "SideTokenFactoryChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "account",
        type: "address",
      },
    ],
    name: "Unpaused",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "bool",
        name: "_isUpgrading",
        type: "bool",
      },
    ],
    name: "Upgrading",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "_wrappedCurrency",
        type: "address",
      },
    ],
    name: "WrappedCurrencyChanged",
    type: "event",
  },
  {
    inputs: [],
    name: "CLAIM_TYPEHASH",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "EvmToHathorTokenMap",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "", type: "string" }],
    name: "HathorToEvmTokenMap",
    outputs: [
      { internalType: "address", name: "tokenAddress", type: "address" },
      { internalType: "uint256", name: "originChainId", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "sender", type: "address" }],
    name: "__Pausable_init",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "sender", type: "address" }],
    name: "__PauserRol_init",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_originalTokenAddress",
        type: "address",
      },
      { internalType: "address payable", name: "_from", type: "address" },
      { internalType: "address payable", name: "_to", type: "address" },
      { internalType: "uint256", name: "_amount", type: "uint256" },
      { internalType: "bytes32", name: "_blockHash", type: "bytes32" },
      { internalType: "bytes32", name: "_transactionHash", type: "bytes32" },
      { internalType: "uint32", name: "_logIndex", type: "uint32" },
      { internalType: "uint256", name: "_originChainId", type: "uint256" },
      { internalType: "uint256", name: "_destinationChainId", type: "uint256" },
    ],
    name: "acceptTransfer",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "originalChainId", type: "uint256" },
      { internalType: "address", name: "token", type: "address" },
      { internalType: "string", name: "uid", type: "string" },
    ],
    name: "addHathorToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "addPauser",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "allowTokens",
    outputs: [
      { internalType: "contract IAllowTokens", name: "", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "newAllowTokens", type: "address" },
    ],
    name: "changeAllowTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "newFederation", type: "address" },
    ],
    name: "changeFederation",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "newSideTokenFactory", type: "address" },
    ],
    name: "changeSideTokenFactory",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address payable", name: "to", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "bytes32", name: "blockHash", type: "bytes32" },
          { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
          { internalType: "uint32", name: "logIndex", type: "uint32" },
          { internalType: "uint256", name: "originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.ClaimData",
        name: "_claimData",
        type: "tuple",
      },
    ],
    name: "claim",
    outputs: [
      { internalType: "uint256", name: "receivedAmount", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address payable", name: "to", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "bytes32", name: "blockHash", type: "bytes32" },
          { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
          { internalType: "uint32", name: "logIndex", type: "uint32" },
          { internalType: "uint256", name: "originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.ClaimData",
        name: "_claimData",
        type: "tuple",
      },
    ],
    name: "claimFallback",
    outputs: [
      { internalType: "uint256", name: "receivedAmount", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address payable", name: "to", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "bytes32", name: "blockHash", type: "bytes32" },
          { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
          { internalType: "uint32", name: "logIndex", type: "uint32" },
          { internalType: "uint256", name: "originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.ClaimData",
        name: "_claimData",
        type: "tuple",
      },
      { internalType: "address payable", name: "_relayer", type: "address" },
      { internalType: "uint256", name: "_fee", type: "uint256" },
      { internalType: "uint256", name: "_deadline", type: "uint256" },
      { internalType: "uint8", name: "_v", type: "uint8" },
      { internalType: "bytes32", name: "_r", type: "bytes32" },
      { internalType: "bytes32", name: "_s", type: "bytes32" },
    ],
    name: "claimGasless",
    outputs: [
      { internalType: "uint256", name: "receivedAmount", type: "uint256" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "claimed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "_typeId", type: "uint256" },
          {
            internalType: "address",
            name: "_originalTokenAddress",
            type: "address",
          },
          {
            internalType: "uint8",
            name: "_originalTokenDecimals",
            type: "uint8",
          },
          {
            internalType: "string",
            name: "_originalTokenSymbol",
            type: "string",
          },
          {
            internalType: "string",
            name: "_originalTokenName",
            type: "string",
          },
          { internalType: "uint256", name: "_originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.CreateSideTokenStruct[]",
        name: "createSideTokenStruct",
        type: "tuple[]",
      },
    ],
    name: "createMultipleSideTokens",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "_typeId", type: "uint256" },
      {
        internalType: "address",
        name: "_originalTokenAddress",
        type: "address",
      },
      { internalType: "uint8", name: "_originalTokenDecimals", type: "uint8" },
      { internalType: "string", name: "_tokenSymbol", type: "string" },
      { internalType: "string", name: "_tokenName", type: "string" },
      { internalType: "uint256", name: "_originChainId", type: "uint256" },
    ],
    name: "createSideToken",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "chainId", type: "uint256" },
      { internalType: "string", name: "hathorTo", type: "string" },
    ],
    name: "depositTo",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "deprecatedKnownTokens",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "deprecatedMappedTokens",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "deprecatedOriginalTokens",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "deprecatedSymbolPrefix",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "domainSeparator",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "feePercentageDivider",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getFederation",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getFeePercentage",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "sideToken", type: "address" }],
    name: "getOriginalTokenBySideToken",
    outputs: [
      {
        components: [
          { internalType: "address", name: "tokenAddress", type: "address" },
          { internalType: "uint256", name: "originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.OriginalToken",
        name: "originalToken",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_to", type: "address" },
      { internalType: "uint256", name: "_amount", type: "uint256" },
      { internalType: "bytes32", name: "_blockHash", type: "bytes32" },
      { internalType: "bytes32", name: "_transactionHash", type: "bytes32" },
      { internalType: "uint32", name: "_logIndex", type: "uint32" },
      { internalType: "uint256", name: "_originChainId", type: "uint256" },
      { internalType: "uint256", name: "_destinationChainId", type: "uint256" },
    ],
    name: "getTransactionDataHash",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
    ],
    name: "hasBeenClaimed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
    ],
    name: "hasCrossed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "initDomainSeparator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "sender", type: "address" }],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_manager", type: "address" },
      { internalType: "address", name: "_federation", type: "address" },
      { internalType: "address", name: "_allowTokens", type: "address" },
      { internalType: "address", name: "_sideTokenFactory", type: "address" },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address payable", name: "to", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "bytes32", name: "blockHash", type: "bytes32" },
          { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
          { internalType: "uint32", name: "logIndex", type: "uint32" },
          { internalType: "uint256", name: "originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.ClaimData",
        name: "_claimData",
        type: "tuple",
      },
      {
        internalType: "bytes32",
        name: "transactionDataHashMultichain",
        type: "bytes32",
      },
    ],
    name: "isClaimed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionDataHash", type: "bytes32" },
      {
        internalType: "bytes32",
        name: "transactionDataHashMultichain",
        type: "bytes32",
      },
    ],
    name: "isClaimed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isOwner",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "isPauser",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isUpgrading",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "chainId", type: "uint256" },
      { internalType: "address", name: "originalToken", type: "address" },
    ],
    name: "knownToken",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "knownTokenByChain",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "nonces",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "originalTokenAddresses",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "originalTokenBySideToken",
    outputs: [
      { internalType: "address", name: "tokenAddress", type: "address" },
      { internalType: "uint256", name: "originChainId", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "pause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "paused",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "destinationChainId", type: "uint256" },
      { internalType: "address", name: "tokenToUse", type: "address" },
      { internalType: "string", name: "hathorTo", type: "string" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "receiveTokensTo",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "renouncePauser",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "senderAddresses",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "setFeePercentage",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "sideToken", type: "address" },
      {
        components: [
          { internalType: "address", name: "tokenAddress", type: "address" },
          { internalType: "uint256", name: "originChainId", type: "uint256" },
        ],
        internalType: "struct IBridge.OriginalToken",
        name: "originalToken",
        type: "tuple",
      },
    ],
    name: "setOriginalTokenBySideTokenByChain",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "chainId", type: "uint256" },
      { internalType: "address", name: "originalToken", type: "address" },
      { internalType: "address", name: "sideToken", type: "address" },
    ],
    name: "setSideTokenByOriginalAddressByChain",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bool", name: "_isUpgrading", type: "bool" }],
    name: "setUpgrading",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "_wrappedCurrency", type: "address" },
    ],
    name: "setWrappedCurrency",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "chainId", type: "uint256" },
      { internalType: "address", name: "originalToken", type: "address" },
    ],
    name: "sideTokenByOriginalToken",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "", type: "uint256" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "sideTokenByOriginalTokenByChain",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "sideTokenFactory",
    outputs: [
      { internalType: "contract ISideTokenFactory", name: "", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "operator", type: "address" },
      { internalType: "address", name: "from", type: "address" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "bytes", name: "userData", type: "bytes" },
      { internalType: "bytes", name: "", type: "bytes" },
    ],
    name: "tokensReceived",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "transactionsDataHashes",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "uid", type: "string" }],
    name: "uidToAddress",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "unpause",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [],
    name: "wrappedCurrency",
    outputs: [{ internalType: "contract IWrapped", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  { stateMutability: "payable", type: "receive" },
];
const ALLOW_TOKENS_ABI = [
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "_tokenAddress",
          "type": "address"
        }
      ],
      "name": "AllowedTokenRemoved",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_smallAmountConfirmations",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_mediumAmountConfirmations",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_largeAmountConfirmations",
          "type": "uint256"
        }
      ],
      "name": "ConfirmationsChanged",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "previousOwner",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "OwnershipTransferred",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "address",
          "name": "recipient",
          "type": "address"
        }
      ],
      "name": "PrimaryTransferred",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "_tokenAddress",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_typeId",
          "type": "uint256"
        }
      ],
      "name": "SetToken",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "_typeId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "string",
          "name": "_typeDescription",
          "type": "string"
        }
      ],
      "name": "TokenTypeAdded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "_typeId",
          "type": "uint256"
        },
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "min",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "max",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "daily",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "mediumAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "largeAmount",
              "type": "uint256"
            }
          ],
          "indexed": false,
          "internalType": "struct IAllowTokens.Limits",
          "name": "limits",
          "type": "tuple"
        }
      ],
      "name": "TypeLimitsChanged",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "_tokenAddress",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_lastDay",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "_spentToday",
          "type": "uint256"
        }
      ],
      "name": "UpdateTokensTransfered",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "MAX_TYPES",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "sender",
          "type": "address"
        }
      ],
      "name": "__Secondary_init",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "description",
          "type": "string"
        },
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "min",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "max",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "daily",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "mediumAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "largeAmount",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.Limits",
          "name": "limits",
          "type": "tuple"
        }
      ],
      "name": "addTokenType",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "len",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "name": "allowedTokens",
      "outputs": [
        {
          "internalType": "bool",
          "name": "allowed",
          "type": "bool"
        },
        {
          "internalType": "uint256",
          "name": "typeId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "spentToday",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "lastDay",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "token",
          "type": "address"
        }
      ],
      "name": "calcMaxWithdraw",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "maxWithdraw",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getConfirmations",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "smallAmount",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "mediumAmount",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "largeAmount",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "tokenAddress",
          "type": "address"
        }
      ],
      "name": "getInfoAndLimits",
      "outputs": [
        {
          "components": [
            {
              "internalType": "bool",
              "name": "allowed",
              "type": "bool"
            },
            {
              "internalType": "uint256",
              "name": "typeId",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "spentToday",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "lastDay",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.TokenInfo",
          "name": "info",
          "type": "tuple"
        },
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "min",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "max",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "daily",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "mediumAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "largeAmount",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.Limits",
          "name": "limit",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getTypeDescriptions",
      "outputs": [
        {
          "internalType": "string[]",
          "name": "descriptions",
          "type": "string[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getTypeDescriptionsLength",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getTypesLimits",
      "outputs": [
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "min",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "max",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "daily",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "mediumAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "largeAmount",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.Limits[]",
          "name": "limits",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "sender",
          "type": "address"
        }
      ],
      "name": "initialize",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "_manager",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "_primary",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "_smallAmountConfirmations",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "_mediumAmountConfirmations",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "_largeAmountConfirmations",
          "type": "uint256"
        },
        {
          "components": [
            {
              "internalType": "string",
              "name": "description",
              "type": "string"
            },
            {
              "components": [
                {
                  "internalType": "uint256",
                  "name": "min",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "max",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "daily",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "mediumAmount",
                  "type": "uint256"
                },
                {
                  "internalType": "uint256",
                  "name": "largeAmount",
                  "type": "uint256"
                }
              ],
              "internalType": "struct IAllowTokens.Limits",
              "name": "limits",
              "type": "tuple"
            }
          ],
          "internalType": "struct IAllowTokens.TypeInfo[]",
          "name": "typesInfo",
          "type": "tuple[]"
        }
      ],
      "name": "initialize",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "isOwner",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "token",
          "type": "address"
        }
      ],
      "name": "isTokenAllowed",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "largeAmountConfirmations",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "mediumAmountConfirmations",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "owner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "primary",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "token",
          "type": "address"
        }
      ],
      "name": "removeAllowedToken",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "renounceOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "_smallAmountConfirmations",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "_mediumAmountConfirmations",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "_largeAmountConfirmations",
          "type": "uint256"
        }
      ],
      "name": "setConfirmations",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "components": [
            {
              "internalType": "address",
              "name": "token",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "typeId",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.TokensAndType[]",
          "name": "tokensAndTypes",
          "type": "tuple[]"
        }
      ],
      "name": "setMultipleTokens",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "token",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "typeId",
          "type": "uint256"
        }
      ],
      "name": "setToken",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "typeId",
          "type": "uint256"
        },
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "min",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "max",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "daily",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "mediumAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "largeAmount",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.Limits",
          "name": "limits",
          "type": "tuple"
        }
      ],
      "name": "setTypeLimits",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "smallAmountConfirmations",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "tokenAddress",
          "type": "address"
        }
      ],
      "name": "tokenInfo",
      "outputs": [
        {
          "components": [
            {
              "internalType": "bool",
              "name": "allowed",
              "type": "bool"
            },
            {
              "internalType": "uint256",
              "name": "typeId",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "spentToday",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "lastDay",
              "type": "uint256"
            }
          ],
          "internalType": "struct IAllowTokens.TokenInfo",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "transferOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "recipient",
          "type": "address"
        }
      ],
      "name": "transferPrimary",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "typeDescriptions",
      "outputs": [
        {
          "internalType": "string",
          "name": "",
          "type": "string"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "typeLimits",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "min",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "max",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "daily",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "mediumAmount",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "largeAmount",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "token",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "updateTokenTransfer",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "version",
      "outputs": [
        {
          "internalType": "string",
          "name": "",
          "type": "string"
        }
      ],
      "stateMutability": "pure",
      "type": "function"
    }
  ];

const ERC20_ABI = [
  {
    inputs: [
      { internalType: "string", name: "name", type: "string" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "uint8", name: "decimals", type: "uint8" },
    ],
    payable: false,
    stateMutability: "nonpayable",
    type: "constructor",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "spender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    name: "Approval",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "from", type: "address" },
      { indexed: true, internalType: "address", name: "to", type: "address" },
      {
        indexed: false,
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
    ],
    name: "Transfer",
    type: "event",
  },
  {
    constant: true,
    inputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "address", name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "totalSupply",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { internalType: "address", name: "sender", type: "address" },
      { internalType: "address", name: "recipient", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
];

const FEDERATION_ABI = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "address",
        name: "bridge",
        type: "address",
      },
    ],
    name: "BridgeChanged",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "federator",
        type: "address",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "transactionHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "transactionId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "address",
        name: "originalTokenAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "receiver",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "logIndex",
        type: "uint32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "originChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "destinationChainId",
        type: "uint256",
      },
    ],
    name: "Executed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "currentChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "currentBlock",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "string",
        name: "fedVersion",
        type: "string",
      },
      {
        indexed: false,
        internalType: "uint256[]",
        name: "fedChainsIds",
        type: "uint256[]",
      },
      {
        indexed: false,
        internalType: "uint256[]",
        name: "fedChainsBlocks",
        type: "uint256[]",
      },
      {
        indexed: false,
        internalType: "string[]",
        name: "fedChainsInfo",
        type: "string[]",
      },
    ],
    name: "HeartBeat",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "member",
        type: "address",
      },
    ],
    name: "MemberAddition",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "member",
        type: "address",
      },
    ],
    name: "MemberRemoval",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "previousOwner",
        type: "address",
      },
      {
        indexed: true,
        internalType: "address",
        name: "newOwner",
        type: "address",
      },
    ],
    name: "OwnershipTransferred",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: "uint256",
        name: "required",
        type: "uint256",
      },
    ],
    name: "RequirementChange",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "federator",
        type: "address",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "transactionHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "transactionId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "address",
        name: "originalTokenAddress",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "sender",
        type: "address",
      },
      {
        indexed: false,
        internalType: "address",
        name: "receiver",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "blockHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint32",
        name: "logIndex",
        type: "uint32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "originChainId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "destinationChainId",
        type: "uint256",
      },
    ],
    name: "Voted",
    type: "event",
  },
  {
    inputs: [],
    name: "MAX_MEMBER_COUNT",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_newMember", type: "address" }],
    name: "addMember",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "bridge",
    outputs: [{ internalType: "contract IBridge", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "_required", type: "uint256" }],
    name: "changeRequirement",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "fedVersion", type: "string" },
      { internalType: "uint256[]", name: "fedChainsIds", type: "uint256[]" },
      { internalType: "uint256[]", name: "fedChainsBlocks", type: "uint256[]" },
      { internalType: "string[]", name: "fedChainsInfo", type: "string[]" },
    ],
    name: "emitHeartbeat",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getMembers",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionId", type: "bytes32" },
    ],
    name: "getTransactionCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "originalTokenAddress",
        type: "address",
      },
      { internalType: "address", name: "sender", type: "address" },
      { internalType: "address", name: "receiver", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
      { internalType: "bytes32", name: "blockHash", type: "bytes32" },
      { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
      { internalType: "uint32", name: "logIndex", type: "uint32" },
      { internalType: "uint256", name: "originChainId", type: "uint256" },
      { internalType: "uint256", name: "destinationChainId", type: "uint256" },
    ],
    name: "getTransactionId",
    outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionId", type: "bytes32" },
    ],
    name: "hasVoted",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address[]", name: "_members", type: "address[]" },
      { internalType: "uint256", name: "_required", type: "uint256" },
      { internalType: "address", name: "_bridge", type: "address" },
      { internalType: "address", name: "owner", type: "address" },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "sender", type: "address" }],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "isMember",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isOwner",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionId", type: "bytes32" },
      {
        internalType: "bytes32",
        name: "transactionIdMultichain",
        type: "bytes32",
      },
    ],
    name: "isProcessed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionId", type: "bytes32" },
      {
        internalType: "bytes32",
        name: "transactionIdMultichain",
        type: "bytes32",
      },
    ],
    name: "isVoted",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "members",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "processed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_oldMember", type: "address" }],
    name: "removeMember",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "renounceOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "required",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "_bridge", type: "address" }],
    name: "setBridge",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "transactionId", type: "bytes32" },
    ],
    name: "transactionWasProcessed",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "newOwner", type: "address" }],
    name: "transferOwnership",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "version",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "originalTokenAddress",
        type: "address",
      },
      { internalType: "address payable", name: "sender", type: "address" },
      { internalType: "address payable", name: "receiver", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes32", name: "blockHash", type: "bytes32" },
      { internalType: "bytes32", name: "transactionHash", type: "bytes32" },
      { internalType: "uint32", name: "logIndex", type: "uint32" },
      { internalType: "uint256", name: "originChainId", type: "uint256" },
      { internalType: "uint256", name: "destinationChainId", type: "uint256" },
    ],
    name: "voteTransaction",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "", type: "bytes32" },
      { internalType: "address", name: "", type: "address" },
    ],
    name: "votes",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];
// --------- ABI  END --------------

// --------- TOKENS --------------
const HATHOR_NATIVE_TOKEN = {
  token: "eHTR",
  name: "Hathor Token",
  icon: "https://s2.coinmarketcap.com/static/img/coins/64x64/5552.png",
  11155111: {
    symbol: "eHTR",
    address: "0xf2FC56644abc39a9b540e763d0B558E6714e0a74",
    decimals: 18,
  },
  31: {
    symbol: "HTR",
    address: "0xE3f0Ae350EE09657933CD8202A4dd563c5af941F",
    decimals: 18,
  },
};

const EVM_NATIVE_TOKEN = {
  token: "SLT6",
  name: "Storm Labs Token 6",
  icon: "https://assets.coingecko.com/coins/images/279/standard/ethereum.png?1696501628",
  11155111: {
    symbol: "SLT6",
    address: "0x3Bd3b546F5FB3Ac5Fc50596646C5Efd27889f729",
    decimals: 18,
  },
  31: {
    symbol: "hSLT6",
    address: "0x3Bd3b546F5FB3Ac5Fc50596646C5Efd27889f729",
    decimals: 18,
  },
};

const TOKENS = [HATHOR_NATIVE_TOKEN, EVM_NATIVE_TOKEN];
// --------- TOKENS  END --------------
