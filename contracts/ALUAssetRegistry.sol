// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title ALUAssetRegistry
 * @notice Registers digital assets (such as the official ALU logo) as ERC-721
 *         NFTs. Each NFT stores the asset's SHA-256 fingerprint, who registered
 *         it, and when, so anyone can later check whether a file is authentic.
 */
contract ALUAssetRegistry is ERC721 {
    /// @dev Registration details stored permanently for every asset.
    struct AssetMetadata {
        string name;          // human-readable asset name, e.g. "ALU Official Logo"
        string fileType;      // e.g. "image/png"
        bytes32 contentHash;  // SHA-256 digest of the file
        address registeredBy; // wallet that registered the asset
        uint256 registeredAt; // Unix timestamp of registration
    }

    /// @dev Last issued token ID; the first asset gets ID 1.
    uint256 private _tokenCounter;

    /// @notice Token ID => registration details.
    mapping(uint256 => AssetMetadata) private _assets;

    /// @notice Content hash => true if that file has already been registered.
    mapping(bytes32 => bool) public hashRegistered;

    event AssetRegistered(
        uint256 indexed tokenId,
        address indexed registeredBy,
        bytes32 contentHash,
        string name
    );

    constructor() ERC721("ALU Asset Registry", "ALUA") {}

    /**
     * @notice Register a new asset and mint its NFT to the caller.
     * @param name        Asset name.
     * @param fileType    File type / MIME type.
     * @param contentHash SHA-256 hash of the file.
     * @return tokenId    ID of the newly minted NFT.
     */
    function registerAsset(
        string calldata name,
        string calldata fileType,
        bytes32 contentHash
    ) external returns (uint256 tokenId) {
        require(!hashRegistered[contentHash], "Asset already registered: duplicate content hash");

        // Effects first (checks-effects-interactions): _safeMint calls back into
        // contract receivers, so state must be final before minting.
        _tokenCounter++;
        tokenId = _tokenCounter;
        _assets[tokenId] = AssetMetadata(name, fileType, contentHash, msg.sender, block.timestamp);
        hashRegistered[contentHash] = true;

        _safeMint(msg.sender, tokenId);

        emit AssetRegistered(tokenId, msg.sender, contentHash, name);
    }

    /**
     * @notice Check whether a file's hash matches the one registered for a token.
     * @dev View function: free to call off-chain.
     * @return authentic True if the hashes match.
     * @return message   Human-readable result.
     */
    function verifyLogoIntegrity(uint256 tokenId, bytes32 contentHash)
        external
        view
        returns (bool authentic, string memory message)
    {
        _requireOwned(tokenId); // reverts for tokens that do not exist
        if (_assets[tokenId].contentHash == contentHash) {
            return (true, "Logo is authentic.");
        }
        return (false, "Warning: logo does not match.");
    }

    /// @notice Return the full registration record for a token.
    function getAsset(uint256 tokenId) external view returns (AssetMetadata memory) {
        _requireOwned(tokenId);
        return _assets[tokenId];
    }
}
