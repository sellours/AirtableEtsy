import React, { useState, useEffect } from 'react';
import OAuth from 'oauth-1.0a';

import {
  initializeBlock, useBase, useRecordById, useLoadable, useWatchable, useGlobalConfig,
  Box, Text, Button, Link, Input, Icon
} from '@airtable/blocks/ui';
import {cursor, globalConfig } from '@airtable/blocks';

import { etsyApiKey, etsySharedSecret } from '../config';

// Entry point - main block
function EtsyListingBlock() {
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const globalConfig = useGlobalConfig();

  useLoadable(cursor);

  // If multiple records selected use the first one
  useWatchable(cursor, ['selectedRecordIds'], () => {
    if (cursor.selectedRecordIds.length > 0) {
      setSelectedRecordId(cursor.selectedRecordIds[0]);
    }
  });

  const base = useBase();
  const table = base.getTable('Etsy Listings');

  let content;

  if (!(globalConfig.get('etsyOathToken') && globalConfig.get('etsyOathSecret'))) { // If there's no linked Etsy Account
    content = <AuthBlock />
  }
  else if(cursor.activeTableId !== table.id || !selectedRecordId) { // If no record selected
    content = (
      <Box display="flex" flexDirection="column" alignItems="center" padding={4}>
        <Text fontSize={32} padding={2}>{'Etsy for Airtable'}</Text>
        <Text fontStyle="italic" padding={2}>{'This block lets you create (draft) Etsy listings directly from Airtable'}</Text>
        <Text textColor="green" padding={2}>{'You have a connected Etsy account'}<Icon name="check" size={16} /></Text>
        <Text fontWeight="bold" padding={2}>{'Select a record to see a preview'}</Text>
        <Box backgroundColor="lightGray3" display="flex" flexDirection="column" alignItems="center" padding={2}>
          <Text padding={2}>{'You will need your table to have the following columns in your table'}</Text>
          <Text fontWeight="bold" padding={2}>{'Title, Description, Price, Quantity'}</Text>
        </Box>
      </Box>
    );
  } else { // Record selected - show the block
    content = <ListingPreview table={table} selectedRecordId={selectedRecordId} />;
  }

  return (
    <>{content}</>
  );
}

// Component to handle connecting an Etsy account
function AuthBlock() {
  /* These are all public-facing anyway - they come from the loginURl etc. */
  const [loginLink, setLoginLink] = useState(null);
  const [oauthToken, setOauthToken] = useState(null);
  const [oauthTokenSecret, setOauthTokenSecret] = useState(null);
  const [verifierValue, setVerifierValue] = useState("");
  const [verifyingKey, setVerifyingKey] = useState(null);

  useEffect(() => {
    async function getTempCredentials() {

      var oauth = new OAuth({
        consumer: {
          key: etsyApiKey,
          secret: etsySharedSecret,
        },
      });

      var requestData = {
        url: 'https://cors-anywhere.herokuapp.com/https://openapi.etsy.com/v2/oauth/request_token?scope=listings_w%20listings_r',
        method: 'POST'
      };

      const response = await fetch(requestData.url, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-cache',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...oauth.toHeader(oauth.authorize(requestData)),
        },
      });
      const loginLink = await response.text();

      /* remove login_url from the start of the response */
      const decoded = decodeURIComponent(loginLink);
      let tempCredentialsURL = decoded.split('=');
      tempCredentialsURL.shift();
      tempCredentialsURL = tempCredentialsURL.join('=');

      let params = new URLSearchParams(tempCredentialsURL);
      let token = params.get("oauth_token");
      let tokenSecret = params.get("oauth_token_secret");

      setLoginLink(tempCredentialsURL);
      setOauthToken(token);
      setOauthTokenSecret(tokenSecret);
    }

    getTempCredentials();
  }, []);

  async function submitVerifier() {
    setVerifyingKey(true);

    var oauth = new OAuth({
      consumer: {
        key: etsyApiKey,
        secret: etsySharedSecret,
      },
    });

    let requestData = {
      url:    'https://cors-anywhere.herokuapp.com/https://openapi.etsy.com/v2/oauth/access_token',
      method: 'POST',
      data: {
        oauth_verifier: verifierValue
      }
    };

    let token = {
      key: oauthToken,
      secret: oauthTokenSecret
    }

    const response = await fetch(requestData.url, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...oauth.toHeader(oauth.authorize(requestData, token)),
      },
    });
    const permanentCredentials = await response.text();

    let params = new URLSearchParams(permanentCredentials);
    let permToken = params.get("oauth_token");
    let permTokenSecret = params.get("oauth_token_secret");

    /* Get user_id - needed for accessing shipping template */
    requestData = {
      url: 'https://cors-anywhere.herokuapp.com/https://openapi.etsy.com/v2/users/__SELF__',
      method: 'GET'
    };

    token = {
        key: permToken,
        secret: permTokenSecret,
    }

    const userDataResponse = await fetch(requestData.url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...oauth.toHeader(oauth.authorize(requestData, token)),
      },
    });
    const userDetails = await userDataResponse.json();
    let userID = userDetails.results[0].user_id;

    /* Get shipping template - needed for a createListing call to the Etsy API*/
    requestData = {
      url:    `https://cors-anywhere.herokuapp.com/https://openapi.etsy.com/v2/users/${userID}/shipping/templates`,
      method: 'GET',
    };

    const shippingTemplateResponse = await fetch(requestData.url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...oauth.toHeader(oauth.authorize(requestData, token)),
      },
    });
    const shippingTemplates = await shippingTemplateResponse.json();
    let shippingTemplateID = shippingTemplates.results[0].shipping_template_id;

    // Add shipping template ID to use for the createListing calls later
    if (globalConfig.hasPermissionToSet('shippingTemplateID', shippingTemplateID)) {
      await globalConfig.setAsync('shippingTemplateID', shippingTemplateID);
    }

    /* Set the permanent credentials into the global config */
    if (globalConfig.hasPermissionToSet('etsyOathToken', permToken)) {
      await globalConfig.setAsync('etsyOathToken', permToken);
    }
    if (globalConfig.hasPermissionToSet('etsyOathSecret', permTokenSecret)) {
      await globalConfig.setAsync('etsyOathSecret', permTokenSecret);
    }
  }

  let content = <Text padding={2}>"Something has gone wrong with authentication - please refresh your block"</Text>;

  if (!(globalConfig.get('etsyOathToken') && globalConfig.get('etsyOathSecret'))) {

    content = (<>
      <Text fontSize={32} padding={2}>{'Etsy for Airtable'}</Text>
      <Text fontStyle="italic" padding={2}>{'This block lets you create (draft) Etsy listings directly from Airtable'}</Text>
      <Text textColor="red" padding={2}>{'You are not currently connected to an Etsy Account'}<Icon name="x" size={16} /></Text>
      <Box backgroundColor="lightGray3" display="flex" flexDirection="column" alignItems="center" padding={2}>
        <Text padding={2}>{'You will need your table to have the following columns in your table'}</Text>
        <Text fontWeight="bold" padding={2}>{'Title, Description, Price, Quantity'}</Text>
      </Box>
      <Text fontStyle="italic" textColor="orange" padding={4}><Icon name="upload" size={16} paddingRight={2}/>{'Connecting to the Etsy API to begin a login - please wait, this may take a few minutes but you will only need to do this once :)'}</Text>
    </>);
  }

  if (loginLink){
    content = (<>
      <Text fontStyle="italic" padding={2}>{'Click below to connect your account to the Etsy API and get a verification key'}</Text>
      <Link href={loginLink} target="_blank" icon="hyperlink" padding={2}>{'Connect your Etsy Account'}</Link>
      <Text padding={2}>{'Enter the verification key below'}</Text>
      <Input
        value={verifierValue}
        onChange={e => setVerifierValue(e.target.value)}
        width="200px"
        margin={2}
      />
      <Button onClick={submitVerifier} margin={2}>{'Submit verification key'}</Button>
    </>);
  }

  if (verifyingKey) {
    content = (<>
      <Text textColor="orange" padding={2}>{'Verifying your key - please wait'}</Text>
      <Text>This may take a few minutes</Text>
    </>);
  }

  return (<Box display="flex" flexDirection="column" alignItems="center" padding={4}>{content}</Box>);
}

// Show a preview of the etsy listing and a button to create it
function ListingPreview({
  table,
  selectedRecordId,
}) {
  const [creationState, setCreationState] = useState(null);

  async function sendDraftListing(listingTitle, listingDescription, listingPrice, listingQuantity, shippingTemplate) {
    setCreationState('Creating your listing in Etsy');

    var oauth = new OAuth({
      consumer: {
        key: etsyApiKey,
        secret: etsySharedSecret,
      },
    });

    var requestData = {
      url: 'https://cors-anywhere.herokuapp.com/https://openapi.etsy.com/v2/listings',
      method: 'POST',
    };

    var listingData = {
      quantity: listingQuantity,
      title: listingTitle,
      description: listingDescription,
      price: listingPrice,
      shipping_template_id: shippingTemplate,
      taxonomy_id: 1,
      state: 'draft',
      who_made: 'i_did',
      is_supply: false,
      when_made: 'made_to_order',
    }

    var token = {
        key: globalConfig.get('etsyOathToken'),
        secret: globalConfig.get('etsyOathSecret'),
    }

    const response = await fetch(requestData.url, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-cache',
      headers: {
        'Content-Type': 'application/json',
        ...oauth.toHeader(oauth.authorize(requestData, token)),
      },
      body: JSON.stringify(listingData),
    });
    const responseData = await response.text();
    setCreationState("Made in Etsy, head over to your account to check out the draft");
  }

  // Re-render if the record changes
  const selectedRecord = useRecordById(table, selectedRecordId ? selectedRecordId : '');

  useEffect(() => { // Reset creation state if record changes
    async function resetCreationState() {
      setCreationState("");
    }
    resetCreationState();
  }, [selectedRecordId]);

  const title = selectedRecord.getCellValue('Title');
  const description = selectedRecord.getCellValue('Description');
  const price = selectedRecord.getCellValue('Price');
  const quantity = selectedRecord.getCellValue('Quantity');
  const shippingTemplateID = globalConfig.get('shippingTemplateID');

  if (!title || !description || !price || !quantity) { // Need to have all fields filled in to send the API request
    return (<Box display="flex" flexDirection="column" alignItems="center" padding={4}>
      <Text padding={2}>Please fill in all the required fields</Text>;
    </Box>);
  } else {
    return (<Box display="flex" flexDirection="column" padding={4}>
      <Text padding={2}><b>Title</b> : {title}</Text>
      <Text padding={2}><b>Description</b> : {description}</Text>
      <Text padding={2}><b>Price</b> : {price}</Text>
      <Text padding={2}><b>Quantity</b> : {quantity}</Text>
      <Button margin={2} onClick={() => sendDraftListing(title, description, price, quantity, shippingTemplateID)}>{'Make (Draft) Etsy Listing'}</Button>
      {creationState && <Text textColor="orange" padding={2}>{creationState}</Text>}
    </Box>);
  }
}

initializeBlock(() => <EtsyListingBlock />);
